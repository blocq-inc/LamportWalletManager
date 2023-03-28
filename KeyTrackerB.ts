// AKM -> Advanced Key Managagement

// import { mk_key_pair } from "./functions"
import { ethers } from "ethers"
import BaseKeyTracker from "./BaseKeyTracker"
import { hash, pubFromPri } from "./functions"
import KeyTracker from "./KeyTracker"
import { KeyPair, PubPair, RandPair } from "./types"

export type CompressedKeyPair = {
    secret: string,
    pkh: string,
}

export type AdvancedKeyPair = CompressedKeyPair & KeyPair


// FOR EASY READING
const COMBINE = (a: string, b: string) => ethers.utils.solidityPack(['uint256', 'uint256'], [a, b])
const HASH = (a: string) => ethers.utils.keccak256(a)
const GENERATE_INITIAL_SECRET = () => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ethers.BigNumber.from(ethers.utils.randomBytes(32)).toHexString()))

const dropFirstTwoChars = (a: string) => a.slice(2)

/**
 * @name uncompressLamport
 * @description Uncompresses a compressed key pair
 * @date Febuary 15th 2023
 * @author William Doyle 
 */
export function uncompressLamport(compressed: CompressedKeyPair): AdvancedKeyPair {
    // 1. generate 512 intermediate secrets
    const intermediate_secrets: string[] = Array.from({ length: 512 }).map((_, index: number) => HASH(COMBINE(compressed.secret, index.toString())))
    // const intermediate_secrets: string[] = Array.from({ length: 512 }).map((_, index: number) => dropFirstTwoChars(HASH(COMBINE(compressed.secret, index.toString()))))
    // 2. pair them up
    const leftIntermediateSecrets: string[] = intermediate_secrets.filter((_, i) => i % 2 === 0)
    const rightIntermediateSecrets: string[] = intermediate_secrets.filter((_, i) => i % 2 === 1)
    const pri: RandPair[] = leftIntermediateSecrets.map((l, i) => [l, rightIntermediateSecrets[i]]) as RandPair[]
    // 3. derive public key
    const pub: PubPair[] = pubFromPri(pri.map(p => [p[0], p[1]]))
    // 4. derive hash of public key
    const pkh = KeyTracker.pkhFromPublicKey(pub)
    // 5. verify hash matches
    if (pkh !== compressed.pkh)
        throw new Error('Public Key Hash Does Not Match Secret')

    // 6. return key pair  
    return {
        ...compressed,
        pri,
        pub
    } as AdvancedKeyPair
}

/**
 * @name compressLamport
 * @description Compresses a key pair to only the secret and the public key hash
 * @date Febuary 15th 2023
 * @author William Doyle 
 */
export function compressLamport (keyPair: AdvancedKeyPair): CompressedKeyPair {
    return {
        secret: keyPair.secret,
        pkh: keyPair.pkh
    } as CompressedKeyPair
}


export function mk_compressed_key_pair(): AdvancedKeyPair {
    // generate single 32 bytes secret
    const secret: string = GENERATE_INITIAL_SECRET()
    // derive 512 intermediate secrets
    const intermediate_secrets: string[] = Array.from({ length: 512 }).map((_, index: number) => HASH(COMBINE(secret, index.toString())))
    // const intermediate_secrets: string[] = Array.from({ length: 512 }).map((_, index: number) => dropFirstTwoChars(HASH(COMBINE(secret, index.toString()))))
    // pair them up
    const leftIntermediateSecrets: string[] = intermediate_secrets.filter((_, i) => i % 2 === 0)
    const rightIntermediateSecrets: string[] = intermediate_secrets.filter((_, i) => i % 2 === 1)
    // zip them up
    const pri: RandPair[] = leftIntermediateSecrets.map((l, i) => [l, rightIntermediateSecrets[i]]) as RandPair[]
    // derive public key
    const pub: PubPair[] = pubFromPri(pri.map(p => [p[0], p[1]]))
    // derive hash of public key
    const pkh = KeyTracker.pkhFromPublicKey(pub)
    return {
        pri,
        pub,
        secret,
        pkh
    } as AdvancedKeyPair
}

/**
 * @name KeyTrackerB
 * @description A class that keeps track of keys and allows you to get them
 * @date Febuary 15th 2023
 * @author William Doyle
 */
export default class KeyTrackerB extends BaseKeyTracker {
    keys: CompressedKeyPair[] = []

    get count() {
        return this.keys.length
    }

    more(amount: number = 2) : AdvancedKeyPair[] {
        const keys = Array.from({ length: amount }, () => mk_compressed_key_pair())
        const asCompressed = keys.map(k => compressLamport(k))
        this.keys.push(...asCompressed) // save as compressed
        return keys // return as uncompressed
    }

    getOne() {
        const returnValue = this.keys.shift()
        if (returnValue === undefined)
            throw new Error('No keys left')
        return uncompressLamport(returnValue)
    }

    getN(amount: number) {
        return this.keys.splice(0, amount).map(k => uncompressLamport(k))
    }
}