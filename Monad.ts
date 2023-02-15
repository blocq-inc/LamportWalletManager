import { ethers } from 'ethers'
import {
    RandPair,
    PubPair,
    KeyPair,
    Sig
} from './types'
import {
    hash_b,
    verify_signed_hash,
    sign_hash,
} from './functions'
import KeyTracker from "./KeyTracker"

/**
 * @name Monad
 * @date December 5th 2022
 * @author William Doyle
 */
export default class Monad<T> {
    private _value: T;

    constructor(value: T) {
        this._value = value;
    }

    bind<U>(transform: (value: T) => Monad<U>): Monad<U> {
        return transform(this._value);
    }

    unwrap(): T {
        return JSON.parse(JSON.stringify(this._value)) as T;
    }
}

// MONADIC FUNCTIONS
const packPublicKeyHashes = (publicKeyHashes: string[]) => new Monad(ethers.utils.solidityPack(['bytes32[]'], [publicKeyHashes]))
const keysToKeyHashes = (keyPairs: KeyPair[]) => new Monad(keyPairs.map(kp => KeyTracker.pkhFromPublicKey(kp.pub)))
const hashBWithMonad = (data: string) => new Monad(hash_b(data))
const signHashWithMonadAndCurry = (privateKey: RandPair[]) => (hashToSign: string) => new Monad(sign_hash(hashToSign, privateKey))
// const convertSignatureForSolidity = (signature: string[]) => new Monad(signature.map(s => `0x${s}`))
const convertSignatureForSolidity = (signature: string[]) => new Monad(signature.map((s: string) => {
    if (s.startsWith('0x'))
        return s
    return `0x${s}`
}))
const packAddressAndUint256 = (input: [string, string]) => new Monad(ethers.utils.solidityPack(['address', 'uint256'], input))
const checkSignature = (publicKey: PubPair[]) => (hashToSign: string) => (signature: Sig) => {
    const isValid = verify_signed_hash(hashToSign, signature, publicKey)
    if (!isValid)
        throw new Error('Invalid signature')
    return new Monad(signature)
}
const packAddressUint256AndAddress = (input: string[]) => new Monad(ethers.utils.solidityPack(['address', 'uint256', 'address'], input))
const packAddressUint256AndUint256 = (input: string[]) => new Monad(ethers.utils.solidityPack(['address', 'uint256', 'uint256'], input))
const packAddress = (input: string) => new Monad(ethers.utils.solidityPack(['address'], [input]))
const packUint256 = (input: string) => new Monad(ethers.utils.solidityPack(['uint256'], [input]))
const packAddressAndAddress = (input: string[]) => new Monad(ethers.utils.solidityPack(['address', 'address'], input))
const packUint256AndAddress = (input: string[]) => new Monad(ethers.utils.solidityPack(['uint256', 'address'], input))
const packBytes32Uint256AndBytes32 = (input: string[]) => new Monad(ethers.utils.solidityPack(['bytes32', 'uint256', 'bytes32'], input))

export {
    hashBWithMonad,
    checkSignature,
    keysToKeyHashes,
    signHashWithMonadAndCurry,
    convertSignatureForSolidity,
    packAddress,
    packUint256,
    packPublicKeyHashes,
    packAddressAndUint256,
    packAddressAndAddress,
    packUint256AndAddress,
    packAddressUint256AndAddress,
    packAddressUint256AndUint256,
}