import { mk_key_pair } from "./functions"
import { KeyPair } from "./types"

/**
 * @name KeyTrackerA
 * @description A class that keeps track of keys and allows you to get them
 * @date December 5th 2022
 * @author William Doyle
 */
export default class KeyTrackerA {
    keys: KeyPair[] = []

    get count() {
        return this.keys.length
    }

    more(amount: number = 2) {
        const keys = Array.from({ length: amount }, () => mk_key_pair())
        this.keys.push(...keys)
        return keys
    }

    getOne() {
        const returnValue = this.keys.shift()
        if (returnValue === undefined)
            throw new Error('No keys left')
        return returnValue
    }

    getN(amount: number) {
        return this.keys.splice(0, amount)
    }
}