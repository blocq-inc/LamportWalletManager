// AKM -> Advanced Key Managagement

// import { mk_key_pair } from "./functions"
import { ethers } from "ethers"
import { hash, pubFromPri } from "./functions"
import KeyTracker from "./KeyTracker"
import { KeyPair, PubPair, RandPair } from "./types"
import { type CompressedKeyPair, type AdvancedKeyPair } from "./KeyTrackerB"
import BaseKeyTracker from "./BaseKeyTracker"

// FOR EASY READING
const COMBINE = (a: string, b: string) => ethers.utils.solidityPack(['uint256', 'uint256'], [a, b])
const HASH = (a: string) => ethers.utils.keccak256(a)
const GENERATE_INITIAL_SECRET = () => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ethers.BigNumber.from(ethers.utils.randomBytes(32)).toHexString()))

export function mk_compressed_key_pair_from_seed_and_nonce(seed: string, nonce: string): AdvancedKeyPair {
    // generate single 32 bytes secret
    const secret: string = HASH(COMBINE(seed, nonce))
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
 * @name KeyTrackerC
 * @description successive key generation
 * @date Febuary 15th 2023
 * @author William Doyle
 */
export default class KeyTrackerC extends BaseKeyTracker {
    seed: string = ""
    nonce: number = 0 // number of keys generated
    _count: number = 0 // number of keys left

    constructor() {
        super()
        this.seed = GENERATE_INITIAL_SECRET()
    }

    get count() {
        return this._count
    }

    get exhausted() {
        return this.count === 0
    }

    more(amount: number = 2): AdvancedKeyPair[] {
        const keys = Array.from({ length: amount }, () => {
            const rval = mk_compressed_key_pair_from_seed_and_nonce(this.seed, this.nonce.toString())
            this.nonce++
            this._count++
            return rval
        })
        return keys // return as uncompressed
    }

    getOne() {
        const nonceToUse = this.nonce - this._count
        const key = mk_compressed_key_pair_from_seed_and_nonce(this.seed, nonceToUse.toString())
        this._count -= 1
        return key
    }

    getN(amount: number) {
        return Array.from({ length: amount }, () => this.getOne())
    }
}