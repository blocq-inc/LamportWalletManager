import BaseKeyTracker from "./BaseKeyTracker";
import KeyTrackerA from "./KeyTrackerA";
import KeyTrackerB from "./KeyTrackerB";
import KeyTrackerC from "./KeyTrackerC";

/**
 * @name MultiSourceKeyTracker
 * @description A class that keeps track of keys and allows you to get them
 * @date March 28th 2023
 * @author William Doyle
 */
export default class MultiSourceKeyTracker extends BaseKeyTracker {
    keyTrackers: BaseKeyTracker[] = []

    get count() {
        return this.keyTrackers.reduce((a, b) => a + b.count, 0)
    }

    get exhausted() {
        return this.count === 0
    }

    more(amount: number = 2) {
        // Default to most secure key tracker
        return this.moreTypeA(amount)
    }

    getOne() {
        // get the first kley tracker that is not exhausted
        const keyTracker = this.keyTrackers.find(k => !k.exhausted)
        if (keyTracker === undefined)
            throw new Error('No keys left')
        return keyTracker.getOne()
    }

    getN (amount: number) {
        // get the first kley tracker that is not exhausted
        const keyTracker = this.keyTrackers.find(k => !k.exhausted)
        if (keyTracker === undefined)
            throw new Error('No keys left')
        return keyTracker.getN(amount)
        // TODO: handle the case where the selected key tracker does not have enough keys --> move on to the next key tracker
    }

    moreTypeA(amount: number = 2) {
        const newKeyTracker : KeyTrackerA = new KeyTrackerA()
        const rval = newKeyTracker.more(amount)
        this.keyTrackers.push(newKeyTracker)
        return rval
    }

    moreTypeB(amount: number = 2) {
        const newKeyTracker : KeyTrackerB = new KeyTrackerB()
        const rval = newKeyTracker.more(amount)
        this.keyTrackers.push(newKeyTracker)
        return rval
    }

    moreTypeC(amount: number = 2) {
        const newKeyTracker : KeyTrackerC = new KeyTrackerC()
        const rval = newKeyTracker.more(amount)
        this.keyTrackers.push(newKeyTracker)
        return rval
    }
}