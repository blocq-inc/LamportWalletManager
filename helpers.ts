import { ethers } from "ethers"
import { checkSignature, convertSignatureForSolidity, hashBWithMonad, keysToKeyHashes, KeyTracker, Monad, signHashWithMonadAndCurry } from "./index"
import KeyTrackerA from "./KeyTrackerA"
import KeyTrackerB from "./KeyTrackerB"
import KeyTrackerC from "./KeyTrackerC"
import { KeyPair } from "./types"
// import kyber from 'crystals-kyber'
// import * as crypto from 'crypto'

type PubPri = {
    pub: any,
    pri: any
}

// class Kyber {
//     static newKeyPair(): PubPri {
//         const a = kyber.KeyGen1024()
//         const pub: Uint8Array = a[0]
//         const pri: Uint8Array = a[1]

//         const pubHex = Buffer.from(pub).toString('hex')
//         const priHex = Buffer.from(pri).toString('hex')

//         return {
//             pub: pubHex,
//             pri: priHex
//         }
//     }
// }

/**
 * @name getSelector
 * @description Gets the selector for a function in a contract
 * @date Febuary 14th 2023
 * @author William Doyle 
 */
const getSelector = (contract: any, functionName: string) => {
    const iface = contract.interface
    const fragment = iface.getFunction(functionName)
    return iface.getSighash(fragment)
}

/**
 * @name isValidPublicKey
 * @description Checks if a public key is valid
 * @date Febuary 16th 2023
 * @author William Doyle 
 */
const isValidPublicKey = async (signingKeys: KeyPair, contract: any) => {
    const publicKeyHash = KeyTracker.pkhFromPublicKey(signingKeys.pub)
    const isRedeemable = await contract.isRedeemable(publicKeyHash)
    // console.log(`Is redeemable: ${isRedeemable} | ${publicKeyHash}`)
    return isRedeemable
}

/**
 * @name checkValidPublicKey
 * @description Checks if a public key is valid
 * @date Febuary 16th 2023
 * @author William Doyle 
 */
const checkValidPublicKey = async (signingKeys: KeyPair, contract: any) => {
    const isValid = await isValidPublicKey(signingKeys, contract)
    if (!isValid)
        throw new Error('Invalid signing key')
}

/**
 * @name addNKeys
 * @description Adds n keys to the lamport wallet contract
 * @author William Doyle
 * @date Febuary 8th 2023
 */
const addNKeys = async (n: number, walletContract: any, keys: KeyTrackerA | KeyTrackerB | KeyTrackerC) => {
    const signingKeys = keys.getOne()

    await checkValidPublicKey(signingKeys, walletContract)

    const keyPairsToAdd: KeyPair[] = keys.more(n)
    const publicKeyHashes = keyPairsToAdd.map(kp => KeyTracker.pkhFromPublicKey(kp.pub))
    const selector = getSelector(walletContract, 'addPublicKeyHashes')
    const prep = (publicKeyHashes: string[]) => new Monad(ethers.utils.solidityPack(['bytes32[]', 'bytes4'], [publicKeyHashes, selector]))

    const hashToSign = new Monad(keyPairsToAdd)
        .bind(keysToKeyHashes)
        .bind(prep)
        .bind(hashBWithMonad)

    const signature = hashToSign
        .bind(signHashWithMonadAndCurry(signingKeys.pri))
        .bind(checkSignature(signingKeys.pub)(hashToSign.unwrap()))
        .bind(convertSignatureForSolidity)

    const gasLimit = await walletContract.estimateGas.addPublicKeyHashes(publicKeyHashes, signingKeys.pub, signature.unwrap())
    const gasPrice = await walletContract.provider.getGasPrice()
    return await walletContract.addPublicKeyHashes(publicKeyHashes, signingKeys.pub, signature.unwrap(), {
        gasLimit: gasLimit,
        gasPrice: gasPrice
    })
}

/**
 * @name setDetail
 * @description set a detail on the contract
 * @author William Doyle
 * @date Febuary 14th 2023
 * @note value must be formated as hex data
 */
const setDetail = async (contract: any, keys: KeyTrackerA | KeyTrackerB | KeyTrackerC, typehash: string, value: string) => {
    const selector = getSelector(contract, 'setDetail')
    const hashToSign = new Monad(ethers.utils.solidityPack(['bytes32', 'bytes', 'bytes4'], [typehash, value, selector]))
        .bind(hashBWithMonad)

    const signingKeys = keys.getOne()

    await checkValidPublicKey(signingKeys, contract)


    const signature = hashToSign
        .bind(signHashWithMonadAndCurry(signingKeys.pri))
        .bind(checkSignature(signingKeys.pub)(hashToSign.unwrap()))
        .bind(convertSignatureForSolidity)

    return await contract.setDetail(typehash, value, signingKeys.pub, signature.unwrap())
}

/**
 * @name endorseMessage
 * @description commit to an arbitrary human readable message
 * @author William Doyle
 * @date Febuary 13th 2023  
 */
const endorseMessage = async (_message: string, contract: any, liveKeys: KeyTrackerA | KeyTrackerB | KeyTrackerC) => {
    const signingKeys = liveKeys.getOne()

    await checkValidPublicKey(signingKeys, contract)

    const message = ethers.utils.keccak256(ethers.utils.solidityPack(['string'], [_message]))
    const selector = getSelector(contract, 'endorseMessage')
    const hashToSign = new Monad(ethers.utils.keccak256(ethers.utils.solidityPack(['bytes32', 'bytes4'], [message, selector])))
    const signature = hashToSign
        .bind(signHashWithMonadAndCurry(signingKeys.pri))
        .bind(checkSignature(signingKeys.pub)(hashToSign.unwrap()))
        .bind(convertSignatureForSolidity)

    return await contract.endorseMessage(message, signingKeys.pub, signature.unwrap())
}


/**
 * @name endorsePublicKeyHash
 * @description commit to a public key hash from another cryptosystem
 * @author William Doyle
 * @date Febuary 13th 2023
 */
const endorsePublicKeyHash = async (typehash: string, index: string, keyhash: string, contract: any, keys: KeyTrackerA | KeyTrackerB | KeyTrackerC) => {
    const selector = getSelector(contract, 'endorsePKH')
    const hashToSign = new Monad(ethers.utils.solidityPack(['bytes32', 'uint256', 'bytes32', 'bytes4'], [typehash, index, keyhash, selector]))
        .bind(hashBWithMonad)

    const signingKeys = keys.getOne()
    await checkValidPublicKey(signingKeys, contract)

    const signature = hashToSign
        .bind(signHashWithMonadAndCurry(signingKeys.pri))
        .bind(checkSignature(signingKeys.pub)(hashToSign.unwrap()))
        .bind(convertSignatureForSolidity)

    return await contract.endorsePKH(typehash, index, keyhash, signingKeys.pub, signature.unwrap())
}

/**
 * @name sendEtherFromContract
 * @description Sends ether from the lamport wallet contract
 * @author William Doyle
 * @date Febuary 8th 2023 
 */
const sendEtherFromContract = async (walletContract: any, keys: KeyTrackerA | KeyTrackerB | KeyTrackerC, to: string, amount: string) => {
    const signingKeys = keys.getOne()
    await checkValidPublicKey(signingKeys, walletContract)

    const selector = getSelector(walletContract, 'sendEther')
    const hashToSign = new Monad(ethers.utils.solidityPack(['address', 'uint256', 'bytes4'], [to, amount, selector]))
        .bind(hashBWithMonad)

    const signature = hashToSign
        .bind(signHashWithMonadAndCurry(signingKeys.pri))
        .bind(checkSignature(signingKeys.pub)(hashToSign.unwrap()))
        .bind(convertSignatureForSolidity)

    return await walletContract.sendEther(to, amount, signingKeys.pub, signature.unwrap())
}


export {
    addNKeys,
    setDetail,
    endorseMessage,
    endorsePublicKeyHash,
    getSelector,
    // Kyber,
    PubPri, 
    sendEtherFromContract,
}