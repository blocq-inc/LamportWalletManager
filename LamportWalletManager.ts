import { ethers } from 'ethers'
import KeyTracker from './KeyTracker'
import supportedBlockchains from './supportedBlockchains.json'
import factoryabi from './abi/factoryabi.json'
import walletabi from './abi/walletabi.json'
import erc20abi from './abi/erc20abi.json'
import erc721abi from './abi/erc721abi.json'
import { LamportKeyPair, KeyPair, PubPair } from './types'
import { hash_b, mk_key_pair, sign_hash, verify_signed_hash, } from './functions'

export type PositiveIntegerLessThanTen = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/**
 * @name TokenInfo
 * @description A type to hold an NFT's token id and uri
 */
export type TokenInfo = {
    tokenId: string
    tokenURI: string
}

/**
 * @name Friend
 * @description A named alias for an EVM address
 */
type Friend = {
    address: string
    name: string
}

/**
 * @name WaiterCallback
 * @description used to track the progress of a transaction
 */
export type WaiterCallback = () => Promise<ethers.providers.TransactionReceipt>


/**
 * @name lamport_getCurrentAndNextKeyData
 * @description A convenience function 
 * @author William Doyle
 */
function lamport_getCurrentAndNextKeyData(k: KeyTracker): ({
    current_keys: LamportKeyPair;
    next_keys: LamportKeyPair;
    nextpkh: string;
    currentpkh: string;
}) {
    const current_keys: LamportKeyPair = JSON.parse(JSON.stringify(k.currentKeyPair()))
    const next_keys: LamportKeyPair = JSON.parse(JSON.stringify(k.getNextKeyPair()))
    const nextpkh = KeyTracker.pkhFromPublicKey(next_keys.pub)
    const currentpkh = KeyTracker.pkhFromPublicKey(current_keys.pub)

    return {
        current_keys,
        next_keys,
        nextpkh,
        currentpkh
    }
}

/**
 * @name buildCallData
 * @description A function to construct the data bundle to be passed to SimpleWallet::execute
 * @author William Doyle 
 * @date October 25th 2022
 */
function buildCallData(abi: any, functionSignature: string, args: any[], address: string, value: string = '0', gas: string = '100000'): string {
    const encoder: ethers.utils.AbiCoder = new ethers.utils.AbiCoder()
    const iface = new ethers.utils.Interface(abi)
    const _funSig = iface.encodeFunctionData(functionSignature, args)
    const _data = encoder.encode(['address', 'bytes', 'uint256', 'uint256'], [address, _funSig, value, gas])
    return _data
}

/**
 * @name buildExecuteArguments
 * @description
 * @author William Doyle
 */
function buildExecuteArguments(k: KeyTracker, functionName: string, abi: any, address: string, args: any[], value: string = '0', gas: string = '100000'): any[] {
    const { current_keys, next_keys, nextpkh, currentpkh } = lamport_getCurrentAndNextKeyData(k)
    const _data = buildCallData(abi, functionName, args, address, value, gas)
    const packed = ethers.utils.solidityPack(['bytes', 'bytes32'], [_data, nextpkh])
    const callhash = hash_b(packed)
    const sig = sign_hash(callhash, current_keys.pri)
    const is_valid_sig = verify_signed_hash(callhash, sig, current_keys.pub)
    if (!is_valid_sig)
        throw new Error(`buildExecuteArguments:: Invalid Lamport Signature`)
    return [_data, current_keys.pub, nextpkh, sig.map(s => `0x${s}`)]
}

/**
 * @name State
 * @description a type that represents the state of the LamportWalletManager
 * @author William Doyle
 * @date November 1st 2022
 */
type State = {
    chainId: string
    walletAddress: string
    ts: number // timestamp ... will be updated when serialized so that we can tell which version of the file is the most recent
    kt: KeyTracker
    network_provider_url: string
    eoa_signing_pri: string     // a private key for signing messages on behalf of the Smart Contract Wallet
    eoa_gas_pri: string | null   // a private key for paying for gas
    currency_contracts: string[]
    backup_keys: KeyPair[]
    nft_contracts: string[]
    friends: Friend[]
    tx_hashes: string[]
}

type GasInfo = {
   gasLimit: ethers.BigNumber | null, 
   gasPrice: ethers.BigNumber | null,
   type: "MANUAL" | "AUTO" | "UNSPECIFIED"
}

const defaultGasInfo: GasInfo = {
    gasLimit: null,
    gasPrice: null,
    type: "UNSPECIFIED"
}

/**
 * @name LamportWalletManager
 * @description A class to manage all the logic for the lamport wallet interactions
 * @author William Doyle
 * @date November 1st 2022
 */
export default class LamportWalletManager {
    state: State = {} as State
    gasPayer: ethers.Signer | null = null
    provider: ethers.providers.JsonRpcProvider | null = null

    /**
     * @name getGasPayer
     * @description a function to get the gas payer if there is one
     * @date November 23rd 2022
     * @author William Doyle 
     */
    async getGasPayer(): Promise<ethers.Wallet | ethers.Signer> {
        if (this.state.eoa_gas_pri) {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return new ethers.Wallet(this.state.eoa_gas_pri, provider)
        }

        if (this.gasPayer)
            return this.gasPayer

        throw new Error(`getGasPayer:: No gas payer available, you must set one with setGasPayer`)
    }

    /**
     *  @naem setGasPayer
     *  @description a function to set the gas payer... to be used in the browser where we don't have direct access to the private key 
     *  @date November 23rd 2022
     *  @author William Doyle
     */
    setGasPayer(gasPayer: ethers.Signer) {
        this.gasPayer = gasPayer
    }

    /**
     * @name _buyNew
     * @description a function to buy a new wallet
     * @date November 23rd 2022
     * @author William Doyle 
     */
    static async _buyNew(signer: ethers.Signer | ethers.Wallet, blockchain: string, gasInfo : GasInfo ): Promise<LamportWalletManager> {
        const {
            factoryAddress,
            rpc,
            chainid,
            price
        } = (() => {
            const rval = supportedBlockchains.find((bc: any) => bc.name === blockchain)
            if (!rval)
                throw new Error(`buyNew:: Unsupported Blockchain ${blockchain}`)
            return rval
        })()
        const factory = new ethers.Contract(factoryAddress, factoryabi, signer)
        const eip1271Wallet = ethers.Wallet.createRandom()

        const kt: KeyTracker = new KeyTracker()

        // const gasLimit = await factory.estimateGas.createWalletEther(eip1271Wallet.address, kt.pkh,)
        // const gasPrice = await signer.getGasPrice()

        // const tx = await factory.createWalletEther(eip1271Wallet.address, kt.pkh, {
        //     value: ethers.utils.parseEther(price.toString()),
        //     // gasLimit: gasLimit,
        //     // gasPrice: gasPrice
        // })
        const tx = await (async () => {
            switch (gasInfo.type) {
                case "MANUAL":
                    {
                        // ensure limits are not null
                        if (!gasInfo.gasLimit || !gasInfo.gasPrice)
                            throw new Error(`buyNew:: Manual Gas Limit and Gas Price must be specified if gasInfo.type === "MANUAL"`)

                        return await factory.createWalletEther(eip1271Wallet.address, kt.pkh, {
                            value: ethers.utils.parseEther(price.toString()),
                            gasLimit: gasInfo.gasLimit,
                            gasPrice: gasInfo.gasPrice
                        })
                    }
                case "AUTO":
                    {
                        const gasLimit = await factory.estimateGas.createWalletEther(eip1271Wallet.address, kt.pkh,)
                        const gasPrice = await signer.getGasPrice()

                        return await factory.createWalletEther(eip1271Wallet.address, kt.pkh, {
                            value: ethers.utils.parseEther(price.toString()),
                            gasLimit: gasLimit,
                            gasPrice: gasPrice
                        })
                    }
                case "UNSPECIFIED":
                    {
                        return await factory.createWalletEther(eip1271Wallet.address, kt.pkh, {
                            value: ethers.utils.parseEther(price.toString()),
                        })
                    }
                default:
                    throw new Error(`buyNew:: Unsupported GasInfo Type ${gasInfo.type} expected "MANUAL" | "AUTO" | "UNSPECIFIED"`)
            }
        })()

        const event = (await tx.wait()).events.find((e: any) => e.event === "WalletCreated")
        const walletAddress = event.args.walletAddress

        const pri = (() => {
            if (signer instanceof ethers.Wallet) {
                return signer.privateKey
            }
            return null
        })()

        const _lwm: LamportWalletManager = new LamportWalletManager(walletAddress, chainid, kt, rpc, eip1271Wallet.privateKey, pri)

        if (chainid === '137') { // polygon
            _lwm.addNFT(`0x34a86b3b9523d2d19bbf199329983c802b3d4760`) // Proof-of-quantum certificate type 1

            _lwm.addCurrency(`0x8f3cf7ad23cd3cadbd9735aff958023239c6a063`) // Dai
            _lwm.addCurrency(`0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b`) // Avalance Token
            _lwm.addCurrency(`0x6f7C932e7684666C9fd1d44527765433e01fF61d`) // Maker
            _lwm.addCurrency(`0x3BA4c387f786bFEE076A58914F5Bd38d668B42c3`) // BNB
            _lwm.addCurrency(`0xd6df932a45c0f255f85145f286ea0b292b21c90b`) // Aave
            _lwm.addCurrency(`0x9c2c5fd7b07e95ee044ddeba0e97a665f142394f`) // 1inch
        }

        if (chainid === '1') { // ethereum
            _lwm.addNFT(`0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D`) // Board Ape Yacht Club
            _lwm.addNFT(`0x06012c8cf97BEaD5deAe237070F9587f8E7A266d`) // CryptoKitties
            _lwm.addNFT(`0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB`) // Cryptopunks 
            _lwm.addNFT(`0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`) // Ethereum Name Service

            _lwm.addCurrency(`0x6b175474e89094c44da98b954eedeac495271d0f`) // Dai
            _lwm.addCurrency(`0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2`) // maker
            _lwm.addCurrency(`0xB8c77482e45F1F44dE1745F52C74426C631bDD52`) // BNB
            _lwm.addCurrency(`0x4fabb145d64652a948d72533023f6e7a623c7c53`) // Binance USD
            _lwm.addCurrency(`0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0`) // Matic
            _lwm.addCurrency(`0xae7ab96520de3a18e5e111b5eaab095312d7fe84`) // stETH
            _lwm.addCurrency(`0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE`) // Shiba Inu
            _lwm.addCurrency(`0x1f9840a85d5af5bf1d1762f925bdaddc4201f984`) // Uniswap
            _lwm.addCurrency(`0x4d224452801aced8b2f0aebe155379bb5d594381`) // ApeCoin
            _lwm.addCurrency(`0x111111111117dc0aa78b770fa6a738034120c302`) // 1inch
            _lwm.addCurrency(`0x93ed3fbe21207ec2e8f2d3c3de6e058cb73bc04d`) // Pinakion (Kleros Court)

        }

        if (chainid === '43114') { // avalanche
            _lwm.addNFT(`0x797ac669a1908ca68cd9854994345f570495541a`) // Avvy Domains .avax
            _lwm.addNFT(`0x2fa83f2fa89f275863b9491b1802dfea5a130024`) // CosmicIsland

            _lwm.addCurrency(`0xd586e7f844cea2f87f50152665bcbc2c279d8d70`) // dai
            _lwm.addCurrency(`0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7`) // wrapped avax
            _lwm.addCurrency(`0x02d980a0d7af3fb7cf7df8cb35d9edbcf355f665`) // Shiba Inu
            _lwm.addCurrency(`0x8ebaf22b6f053dffeaf46f4dd9efa95d89ba8580`) // Uniswap
            _lwm.addCurrency(`0x88128fd4b259552a9a1d457f435a6527aab72d42`) // Maker 
            _lwm.addCurrency(`0xd501281565bf7789224523144fe5d98e8b28f267`) // 1inch
        }

        if (chainid === '1285') { // moonriver
            _lwm.addNFT(`0x5bae38bfb57f0e77f244ac3edcbc91bf94ccd185`) // next gens
            _lwm.addNFT(`0xc433f820467107bc5176b95f3a58248c4332f8de`) // next gems  

            _lwm.addCurrency('0x80a16016cc4a2e6a2caca8a4a498b1699ff0f844') // dai
            _lwm.addCurrency('0x98878b06940ae243284ca214f92bb71a2b032b8a') // wrapped moonriver
            _lwm.addCurrency('0x6bd193ee6d2104f14f94e2ca6efefae561a4334b') // SolarBeam 
        }

        if (chainid === '100') { // GNOSIS
            _lwm.addNFT(`0x22C1f6050E56d2876009903609a2cC3fEf83B415`) // POAP 

            _lwm.addCurrency('0x7122d7661c4564b7c6cd4878b06766489a6028a2') // MATIC
            _lwm.addCurrency('0x4537e328bf7e4efa29d05caea260d7fe26af9d74') // Uniswap
            _lwm.addCurrency('0x9c58bacc331c9aa871afd802db6379a98e80cedb') // Gnosis Token
        }

        if (chainid === '56') { // BSC
            _lwm.addCurrency('0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3') // dai
            _lwm.addCurrency('0x2170ed0880ac9a755fd29b2688956bd959f933f8') // ethereum peg
            _lwm.addCurrency('0x55d398326f99059ff775485246999027b3197955') // peg usd
            _lwm.addCurrency('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c') // wrapped bnb
            _lwm.addCurrency('0xe9e7cea3dedca5984780bafc599bd69add087d56') // peg usd
            _lwm.addCurrency('0x3ee2200efb3400fabb9aacf31297cbdd1d435d47') // cardano peg
            _lwm.addCurrency('0xba2ae424d960c26247dd6c32edc70b295c744c43') // doge peg
            _lwm.addCurrency('0xcc42724c6683b7e57334c4e856f4c9965ed682bd') // matic
            _lwm.addCurrency('0x7083609fce4d1d8dc0c979aab8c869ea2c873402') // polkadot peg
            _lwm.addCurrency('0x2859e4544c4bb03966803b044a93563bd2d0dd4d') // shiba inu peg
            _lwm.addCurrency('0x4338665cbb7b2485a8855a139b75d5e34ab0db94') // litecoin peg
            _lwm.addCurrency('0x1ce0c2827e2ef14d5c4f29a091d735a204794041') // avalanche peg
            _lwm.addCurrency('0xbf5140a22578168fd562dccf235e5d43a02ce9b1') // uniswap peg
            _lwm.addCurrency('0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c') // bitcoin peg
            _lwm.addCurrency('0x5f0da599bb2cccfcf6fdfd7d81743b6020864350') // maker peg 
        }

        if (chainid === '80001') { // mumbai TESTNET
            _lwm.addNFT(`0x4972838dDEED2accEf533BFb45e8121c5Fa7c864`)
            _lwm.addNFT(`0x34992de82775D3ea8d0FCEecf0D0aA734eed90Fe`)
            _lwm.addNFT(`0x72Bd1982693f294f7aaa466d024e3c1B370355BF`)

            _lwm.addCurrency(`0xb2c4d0111Ab40bdB414daeE2e3F53c8e2f7254Ec`) // fake DAI (call mint to receive 1 DAI)
        }


        if (chainid === '43113') { // fuji TESTNET
            _lwm.addCurrency('0x5425890298aed601595a70ab815c96711a31bc65') // usdc
            _lwm.addCurrency('0x9983f755bbd60d1886cbfe103c98c272aa0f03d6') // dexalot 
        }
        // _lwm.addNFT(await factory.mintingAddress())
        // console.log(`minting address: ${await factory.mintingAddress()}`)
        return _lwm
    }

    /**
     * @name buyNew
     * @description a function to buy a new wallet 
     * @date November 4th 2022
     * @author William Doyle
     */
    static async buyNew(gasPrivateKey: string, blockchain: string, gasInfo : GasInfo = defaultGasInfo): Promise<LamportWalletManager> {
        const {
            factoryAddress,
            rpc,
            chainid,
            price
        } = (() => {
            const rval = supportedBlockchains.find((bc: any) => bc.name === blockchain)
            if (!rval)
                throw new Error(`buyNew:: Unsupported Blockchain ${blockchain}`)
            return rval
        })()

        const provider = ethers.getDefaultProvider(rpc)
        const gasWallet = new ethers.Wallet(gasPrivateKey, provider)
        return LamportWalletManager._buyNew(gasWallet, blockchain, gasInfo)
    }

    /**
     * @name buyNew_mm
     * @description a function to buy a new wallet using metamask as the gas payer
     * @date November 23rd 2022
     * @author William Doyle 
     */
    static async buyNew_mm(signer: ethers.Signer, blockchain: string,  gasInfo : GasInfo = defaultGasInfo): Promise<LamportWalletManager> {
        return LamportWalletManager._buyNew(signer, blockchain, gasInfo)
    }

    /**
     * @name toJSON
     * @description serielize the state of the LamportWalletManager
     * @date November 1st 2022
     * @author William Doyle 
     */
    toJSON(): string {
        this.state.ts = Date.now()
        return JSON.stringify(this.state, null, 2)
    }

    /**
     * @name fromJSON
     * @description deserialize the state of a LamportWalletManager and return a new instance of the class with the state set
     * @date November 1st 2022
     * @author William Doyle
     */
    static fromJSON(obj: string): LamportWalletManager {
        const t: LamportWalletManager = new LamportWalletManager('', '', {} as KeyTracker, '', '', '')
        t.state = JSON.parse(obj)
        t.state.kt = Object.assign(new KeyTracker(), t.state.kt)
        return t
    }

    /**
     * @name gasWalletAddress
     * @description a getter for the gas wallet address... computed from the gas private key. This is the vulnrable address that should be used only for gas payments
     * @date November 2022
     * @author William Doyle
     */
    get gasWalletAddress(): string {
        if (this.state.eoa_gas_pri === null)
            throw new Error(`gasWalletAddress:: gas private key is null`)
        return ethers.utils.computeAddress(this.state.eoa_gas_pri)
    }

    /**
     * @name signingWalletAddress
     * @description a getter for the signing wallet address... computed from the signing private key. This is the vulnrable address that should be used only for signing messages (not transactions)
     * @notice it is considered best practice to not use this address for transactions, only for signing messages with ECDSA on behalf of the smart contract wallet (EIP 1271)
     * @date November 2022
     * */
    get signingWalletAddress(): string {
        return ethers.utils.computeAddress(this.state.eoa_signing_pri)
    }

    /**
     * @name constructor
     * @description the constructor for the LamportWalletManager class
     * @date November 1st 2022
     * @author William Doyle 
     */
    constructor(
        address: string,
        chainId: string,
        kt: KeyTracker,
        network_provider_url: string,
        eoa_signing_pri: string,
        eoa_gas_pri: string | null
    ) {
        this.state.walletAddress = address
        this.state.ts = Date.now()
        this.state.chainId = chainId
        this.state.kt = kt
        this.state.network_provider_url = network_provider_url
        this.state.eoa_signing_pri = eoa_signing_pri
        this.state.eoa_gas_pri = eoa_gas_pri
        this.state.backup_keys = []
        this.state.friends = []
        this.state.tx_hashes = []
    }

    /**
     * @name call_isValidSignature
     * @description A function to call the isValidSignature function on the lamport wallet... this function allows us to check if an ECDSA signature is valid (signed on behalf of the contract)
     * @date November 1st 2022
     * @author William Doyle
     */
    call_isValidSignature() {
        throw new Error("Not implemented")
    }

    /**
     * @name call_recover
     * @description call the recover function on the lamport wallet, which will allow us to use one of our recovery keys to recover the wallet
     * @date November 1st 2022
     * @author William Doyle
     */
    async call_recover(selectedRecoveryKeyIndex: PositiveIntegerLessThanTen = 0): Promise<WaiterCallback> {
        const gasWallet = await this.getGasPayer()
        if (gasWallet === null)
            throw new Error(`call_recover:: gas wallet is null`)

        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, gasWallet)

        const recoveryOptions = await lamportwallet.getRecoveryPKHs()
        const recoveryKeyPair = this.state.backup_keys.find(pair => KeyTracker.pkhFromPublicKey(pair.pub) === recoveryOptions[selectedRecoveryKeyIndex])

        if (recoveryKeyPair === undefined)
            throw new Error(`LamportWalletManager:: Could not find recovery key pair`)

        const k2: KeyTracker = new KeyTracker()
        const packed = ethers.utils.solidityPack(['bytes32'], [k2.pkh])
        const callhash = hash_b(packed)
        const sig = sign_hash(callhash, recoveryKeyPair.pri)
        const is_valid_sig = verify_signed_hash(callhash, sig, recoveryKeyPair.pub)

        if (!is_valid_sig)
            throw new Error(`Invalid Lamport Signature`)

        const gasLimit = await lamportwallet.estimateGas.recover(k2.pkh, recoveryKeyPair.pub, sig.map(s => `0x${s}`))
        const gasPrice = await gasWallet.getGasPrice()

        const tx = await lamportwallet.recover(k2.pkh, recoveryKeyPair.pub, sig.map(s => `0x${s}`),
            {
                gasLimit,
                gasPrice
            })

        this.pushTxHash(tx.hash)
        this.state.kt = k2

        return async () => {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return await provider.waitForTransaction(tx.hash)
        }
    }

    /**
     * @name call_setTenRecoveryPKHs
     * @description call setTenRecoveryPKHs on the lamport wallet, which will allow us to set 10 recovery keys in case we lose our wallet details
     * @date November 1st 2022
     * @author William Doyle
     */
    async call_setTenRecoveryPKHs(): Promise<WaiterCallback> {
        const tenKeys = Array.from({ length: 10 }, mk_key_pair)
        const tenPKHs: string[] = tenKeys.map(pair => KeyTracker.pkhFromPublicKey(pair.pub))

        const { current_keys, nextpkh } = lamport_getCurrentAndNextKeyData(this.state.kt)
        const packed = (() => {
            const temp = ethers.utils.solidityPack(['bytes32[]'], [tenPKHs])
            return ethers.utils.solidityPack(['bytes', 'bytes32'], [temp, nextpkh])
        })()

        const callhash = hash_b(packed)
        const sig = sign_hash(callhash, current_keys.pri)
        const is_valid_sig = verify_signed_hash(callhash, sig, current_keys.pub)

        if (!is_valid_sig)
            throw new Error(`LamportWalletManager:: Invalid Lamport Signature`)

        const gasWallet = await this.getGasPayer()
        if (gasWallet === null)
            throw new Error(`call_setTenRecoveryPKHs:: gas wallet is null`)
        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, gasWallet)

        // TODO: ESTIMATE GAS
        const gasLimit = await lamportwallet.estimateGas.setTenRecoveryPKHs(tenPKHs, current_keys.pub, sig.map(s => `0x${s}`), nextpkh)
        const gasPrice = await gasWallet.getGasPrice()

        const tx = await lamportwallet.setTenRecoveryPKHs(tenPKHs, current_keys.pub, sig.map(s => `0x${s}`), nextpkh, {
            gasLimit,
            gasPrice
        })
        // this.state.tx_hashes.push(tx.hash)
        this.pushTxHash(tx.hash)

        this.state.backup_keys = tenKeys
        return async () => {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return await provider.waitForTransaction(tx.hash)
        }
    }

    /**
     * @name call_execute
     * @description call the execute function on the lamport wallet, this will allow us to make arbitraty calls to other contracts from the wallet
     * @date November 1st 2022
     * @author William Doyle
     */
    async call_execute(_contractAddress: string, fsig: string, args: string[], abi: any): Promise<WaiterCallback> {
        const contractAddress = this.nameOrAddressToAddress(_contractAddress)
        const gasWallet = await this.getGasPayer()

        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, gasWallet)

        const executionArguments = buildExecuteArguments(this.state.kt, fsig, abi, contractAddress, args)
        const gasLimit = lamportwallet.estimateGas.execute(...executionArguments)
        const gasPrice = gasWallet.getGasPrice()


        const tx = await lamportwallet.execute(...executionArguments, {
            gasLimit: gasLimit,
            gasPrice: gasPrice
        })

        // this.state.tx_hashes.push(tx.hash)
        this.pushTxHash(tx.hash)

        return async () => {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return await provider.waitForTransaction(tx.hash)
        }
    }

    /**
     * @name call_sendEther
     * @description call the sendEther function on the lamport wallet, this will allow us to send ether to another address from the wallet
     * @date November 1st 2022
     * @author William Doyle
     */
    async call_sendEther(_toAddress: string, _amount: string | number | ethers.BigNumber): Promise<WaiterCallback> {
        const toAddress = this.nameOrAddressToAddress(_toAddress)
        const amount: string = ethers.BigNumber.from(_amount).toString()
        const gasWallet = await this.getGasPayer()

        const { current_keys, nextpkh, } = lamport_getCurrentAndNextKeyData(this.state.kt)
        const packed = (() => {
            const temp = ethers.utils.solidityPack(['address', 'uint256'], [toAddress, amount])
            return ethers.utils.solidityPack(['bytes', 'bytes32'], [temp, nextpkh])
        })()
        const callhash = hash_b(packed)
        const sig = sign_hash(callhash, current_keys.pri)

        const is_valid_sig = verify_signed_hash(callhash, sig, current_keys.pub)
        if (!is_valid_sig)
            throw new Error("LamportWalletmanager::call_sendEther: Invalid Lamport Signature, Generated")

        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, gasWallet)

        // ESTIMATE GAS
        const gasPrice = gasWallet.getGasPrice()
        const gasLimit = await lamportwallet.estimateGas.sendEther(
            toAddress,
            amount,
            current_keys.pub,
            nextpkh,
            sig.map(s => `0x${s}`),
        )

        const tx = await lamportwallet.sendEther(
            toAddress,
            amount,
            current_keys.pub,
            nextpkh,
            sig.map(s => `0x${s}`),
            {
                gasLimit: gasLimit,
                gasPrice: gasPrice
            }
        )

        // this.state.tx_hashes.push(tx.hash)
        this.pushTxHash(tx.hash)

        return async () => {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return await provider.waitForTransaction(tx.hash)
        }
    }

    /**
     * @name call_sendEtherWithManualGas
     * @description send ether to another address from the wallet, but manually set the gas limit and gas price manually
     * @date January 30th 2023
     * @author William Doyle 
     */
    async call_sendEtherWithManualGas(_toAddress: string, _amount: string | number | ethers.BigNumber, gasLimit: string, gasPrice: string): Promise<WaiterCallback> {
        const toAddress = this.nameOrAddressToAddress(_toAddress)
        const amount: string = ethers.BigNumber.from(_amount).toString()
        const gasWallet = await this.getGasPayer()

        const { current_keys, nextpkh, } = lamport_getCurrentAndNextKeyData(this.state.kt)
        const packed = (() => {
            const temp = ethers.utils.solidityPack(['address', 'uint256'], [toAddress, amount])
            return ethers.utils.solidityPack(['bytes', 'bytes32'], [temp, nextpkh])
        })()
        const callhash = hash_b(packed)
        const sig = sign_hash(callhash, current_keys.pri)

        const is_valid_sig = verify_signed_hash(callhash, sig, current_keys.pub)
        if (!is_valid_sig)
            throw new Error("LamportWalletmanager::call_sendEther: Invalid Lamport Signature, Generated")

        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, gasWallet)

        const tx = await lamportwallet.sendEther(
            toAddress,
            amount,
            current_keys.pub,
            nextpkh,
            sig.map(s => `0x${s}`),
            {
                gasLimit: gasLimit,
                gasPrice: gasPrice
            }
        )

        this.pushTxHash(tx.hash)

        return async () => {
            const provider = ethers.getDefaultProvider(this.state.network_provider_url)
            return await provider.waitForTransaction(tx.hash)
        }
    }


    /**
     * @name transfernft
     * @description transfer an NFT to another address
     * @date November 8th 2022
     * @author William Doyle
     */
    async transferNft(_nftAddress: string, tokenId: string, _toAddress: string): Promise<WaiterCallback> {
        const nftAddress = this.nameOrAddressToAddress(_nftAddress)
        const toAddress = this.nameOrAddressToAddress(_toAddress)
        return this.call_execute(nftAddress, 'transferFrom(address,address,uint256)', [this.state.walletAddress, toAddress, tokenId], erc721abi)
    }

    /**
     * @name ethBalanceOf
     * @description get the Eth balance of an address
     * @note this function is marked private because the interface does not need direct access to it
     * @date November 2022
     * @author William Doyle
     * */
    private async ethBalanceOf(_addr: string): Promise<string> {
        const addr = this.nameOrAddressToAddress(_addr)
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        return (await provider.getBalance(addr)).toString()
    }

    /**
     * @name ethBalance
     * @description get the Eth balance of the Lamport Wallet
     * @date November 2022
     * @author William Doyle 
     */
    async ethBalance(): Promise<string> {
        return this.ethBalanceOf(this.state.walletAddress)
    }

    /**
     * @name gasEthBalance
     * @description get the Eth balance of the gas EOA
     * @date November 2022
     * @author William Doyle 
     */
    async gasEthBalance(): Promise<string> {
        return this.ethBalanceOf(this.gasWalletAddress)
    }

    /**
     * @name signingEthBalance
     * @description get the Eth balance of the signing EOA (ideally this should be 0)
     * @date November 2022
     * @author William Doyle 
     */
    async signingEthBalance(): Promise<string> {
        return this.ethBalanceOf(this.signingWalletAddress)
    }

    /**
     * @name addCurrency
     * @description add an address to the list of currencies that the user may be intrested in
     * @date November 2022
     * @author William Doyle 
     */
    addCurrency(_address: string) {
        const address = this.nameOrAddressToAddress(_address)
        if (this.state.currency_contracts === undefined)
            this.state.currency_contracts = []
        this.state.currency_contracts.push(address)
    }

    /**
     * @name addNFT
     * @description add an NFT contract address to the list of NFT contracts that the user may be intrested in
     * @date November 7th 2022
     * @author William Doyle
     */
    addNFT(_address: string) {
        const address = this.nameOrAddressToAddress(_address)
        if (this.state.nft_contracts === undefined)
            this.state.nft_contracts = []
        this.state.nft_contracts.push(address)
    }

    /**
     * @name addFriend
     * @description add an alias for an address
     * @date November 8th 2022
     * @author William Doyle
     */
    addFriend(alias: string, _address: string) {
        const address = this.nameOrAddressToAddress(_address)
        if (this.state.friends === undefined)
            this.state.friends = []
        if (this.state.friends.map(f => f.name).includes(alias))
            throw new Error(`LamportWalletManager::addFriend: alias ${alias} already exists`)
        if (this.state.friends.map(f => f.address).includes(address))
            throw new Error(`LamportWalletManager::addFriend: an alies for this address already exists`)
        const nfriend = {
            name: alias,
            address: address
        } as Friend
        this.state.friends.push(nfriend)
    }

    /**
     * @name getCurrencyInfo
     * @description get the info for a currency given its address
     * @date November 2022
     * @author William Doyle
     * */
    async getCurrencyInfo(_currencyAddress: string): Promise<[string, string, string]> {
        const currencyAddress = this.nameOrAddressToAddress(_currencyAddress)
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const currency = new ethers.Contract(currencyAddress, erc20abi, provider)

        const name = await currency.name()
        const symbol = await currency.symbol()
        const balance: string = await currency.balanceOf(this.state.walletAddress)
        return [name, symbol, balance.toString()]
    }

    /**
     * @name getNFTInfo
     * @description get the info for an NFT given its address
     * @date November 7th 2022
     * @author William Doyle
     */
    async getNFTInfo(_nftAddress: string): Promise<[string, string, string]> {
        const nftAddress = this.nameOrAddressToAddress(_nftAddress)
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const nft = new ethers.Contract(nftAddress, erc721abi, provider)

        const name = await nft.name()
        const symbol = await nft.symbol()
        const balance = await nft.balanceOf(this.state.walletAddress)
        return [name, symbol, balance]
    }

    /**
     * @name getContract
     * @description get a contract object for a given address and abi
     * @date January 29th 2023
     * @author William Doyle 
     */
    getContract(address: string, abi: ethers.ContractInterface) {
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        return new ethers.Contract(address, abi, provider)
    }

    /**
     * @name getErc20Contract
     * @description get a contract object for a given address and abi (or use default abi)
     * @date January 29th 2023
     * @author William Doyle 
     */
    getErc20Contract(address: string, abi = erc20abi) {
        return this.getContract(address, abi)
    }

    /**
     * @name getErc721Contract
     * @description get a contract object for a given address and abi (or use default abi)
     * @date January 29th 2023
     * @author William Doyle 
     */
    getErc721Contract(address: string, abi = erc721abi) {
        return this.getContract(address, abi)
    }

    // Nov 25 2022
    async getTotalSupply(contractAddress: string, abi = erc20abi): Promise<string> {
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        // const contract = new ethers.Contract(contractAddress, erc20abi, provider)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        return (await contract.totalSupply()).toString()
    }

    /**
     * @name getDecimals
     * @description get the number of decimals for a currency
     * @date January 27th 2023
     * @author William Doyle 
     */
    async getDecimals(contractAddress: string, abi = erc20abi): Promise<any> {
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        return await contract.decimals()
    }

    /**
     * @name getMyTokens
     * @description get the info for all the tokens on a erc721 contract that belong to the wallet. Returns null if contract does not implement ERC721Enumerable
     * @date November 8th 2022
     * @author William Doyle
     */
    async getMyTokens(_nftAddress: string): Promise<null | TokenInfo[]> {
        const nftAddress = this.nameOrAddressToAddress(_nftAddress)
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const nft = new ethers.Contract(nftAddress, erc721abi, provider)

        // 1. determine if implements ERC721Enumerable
        const isEnumerable = await nft.supportsInterface("0x780e9d63")
        // 2. if it does not >> early return
        if (!isEnumerable)
            return null
        // 3. if it does >> use the tokenOfOwnerByIndex function to get all the tokens
        const balance = await nft.balanceOf(this.state.walletAddress)
        const p_tokens = Array.from({ length: balance.toNumber() }, async (_, i) => {
            const tid = await nft.tokenOfOwnerByIndex(this.state.walletAddress, i)
            return {
                tokenId: tid,
                tokenURI: await nft.tokenURI(tid)
            } as TokenInfo
        })
        // 4. return the tokens
        return Promise.all(p_tokens)
    }

    /**
     * @name pkh_fromChain
     * @description get the current public key hash as it is on chain (source this data from chain: not from the KeyTracker)
     * @date November 2022
     * @author William Doyle
     */
    async pkh_fromChain(): Promise<string> {
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const lamportwallet: ethers.Contract = new ethers.Contract(this.state.walletAddress, walletabi, provider)
        return await lamportwallet.getPKH()
    }

    /**
     * @name nameOrAddressToAddress
     * @description convert a name or address to just an address (name must be a friend)
     * @date November 8th 2022
     * @author William Doyle
     */
    nameOrAddressToAddress(nameOrAddress: string): string {
        const friend = this.state.friends?.find(f => f.name === nameOrAddress)
        if (friend === undefined)
            return nameOrAddress
        return friend.address
    }

    /**
     * @name eip1271Sign
     * @description sign a message using the eip1271 standard
     * @date November 8th 2022
     * @author William Doyle
     */
    async eip1271Sign(message: string): Promise<string> {
        const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message))
        const signingWallet = new ethers.Wallet(this.state.eoa_signing_pri)
        const signature = await signingWallet.signMessage(messageHash)
        return signature
    }

    /**
     * @name setGasEOA
     * @description set eoa_signing_pri to change the EOA used to sign EVM level transactions / pay gas fee
     * @date November 8th 2022
     * @author William Doyle
     */
    setGasEOA(eoa_gas_pri: string) {
        this.state.eoa_gas_pri = eoa_gas_pri
    }

    /**
     * @name view
     * @description gather all the data needed to visualize the wallet, returs an array of matrices of strings
     * @date November 8th 2022
     * @author William Doyle
     */
    async view(): Promise<string[][][]> {
        const tables: string[][][] = []

        // tables.push([
        // // wallet address + balance
        // [this.state.walletAddress, await this.ethBalance()],
        // // same for gas and signing wallets
        // [this.gasWalletAddress, await this.gasEthBalance(this.gasWalletAddress)],
        // [this.signingWalletAddress, await this.gasEthBalance(this.signingWalletAddress)],
        // ])

        return tables
    }

    /**
     * pkhFromPublicKey
     * @author William Doyle
     * @date November 15th 2022
     */
    static pkhFromPublicKey(publicKey: PubPair[]): string {
        return KeyTracker.pkhFromPublicKey(publicKey)
    }

    /**
     * transferErc20
     * @author William Doyle
     * @date November 15th 2022 
     */
    async transferErc20(address: string, to: string, amount: string): Promise<WaiterCallback> {
        return this.call_execute(address, 'transfer(address,uint256)', [this.nameOrAddressToAddress(to), amount], erc20abi)
    }

    /**
     *  @name chainName
     *  @description get the name of the connected chain
     *  @date November 22nd 2022
     *  @author William Doyle
     */
    get chainName() {
        return supportedBlockchains.find(bchin => bchin.chainid === this.state.chainId)?.name
    }

    /**
     * @name topTxHash
     * @description get the hash of the most recent transaction
     * @date November 24th 2022
     * @author William Doyle
     */
    get topTxHash(): string | null {
        if ((this.state.tx_hashes ?? []).length === 0)
            return null
        return this.state.tx_hashes[this.state.tx_hashes.length - 1]
    }

    /**
     * @name pushTxHash
     * @description push a new tx hash to the tx_hashes array
     * @date November 24th 2022
     * @author William Doyle
     */
    pushTxHash(tx_hash: string) {
        if (this.state.tx_hashes === undefined)
            this.state.tx_hashes = []
        this.state.tx_hashes.push(tx_hash)
    }

    /**
     * @name address
     * @description get the address of the wallet
     * @date November 24th 2022
     * @author William Doyle
     */
    get address(): string {
        return this.state.walletAddress
    }

    /**
     * @name addressQRCodeURL
     * @description get the url of the qr code for the wallet address
     * @date November 24th 2022
     * @author William Doyle
     */
    get addressQRCodeURL(): string {
        return `https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=${this.address ?? ''}&choe=UTF-8`;
    }

    // /**
    //  * @date November 24th 2022
    //  */
    // async history(): Promise<ethers.providers.TransactionReceipt[]> {
    //     const provider = ethers.getDefaultProvider(this.state.network_provider_url)
    //     return Promise.all(this.state.tx_hashes.map(provider.getTransactionReceipt))
    // }

    /**
     * @name get walletABI
     * @description get the wallet abi
     * @date December 1st 2022
     * @author William Doyle
     */
    get walletABI(): ethers.ContractInterface {
        return walletabi as ethers.ContractInterface
    }

    /**
     * @name getDecimalsOfERC20
     * @description get the decimals of an erc20 token
     * @date December 8th 2022
     * @author William Doyle
     */
    async getDecimalsOfERC20(address: string): Promise<string> {
        // construct the contract
        const provider = ethers.getDefaultProvider(this.state.network_provider_url)
        const erc20: ethers.Contract = new ethers.Contract(address, erc20abi, provider)

        // get the decimals
        return (await erc20.decimals()).toString()
    }
}