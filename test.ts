// import { ethers } from "ethers";
// import { randomBytes } from 'crypto'

// const n_one = randomBytes(32)
// const n_two = ethers.utils.randomBytes(32)

// console.log(`---TEST ONE::RAW---`)
// console.log(`n_one --> `, n_one)
// console.log(`n_two --> `, n_two)

// console.log(`---TEST TWO::HEX STRING---`)
// console.log(`n_one --> `, n_one.toString('hex'))
// console.log(`n_two --> `, ethers.BigNumber.from(n_two).toHexString())


import BaseKeyTracker from './BaseKeyTracker'
import KeyTrackerA from './KeyTrackerA'
import KeyTrackerB from './KeyTrackerB'
import KeyTrackerC from './KeyTrackerC'

const keyTrackers : BaseKeyTracker[] = [
    new KeyTrackerA(),
    new KeyTrackerB(),
    new KeyTrackerC(),
]

console.log(`TEST KEY TRACKERS`)

const showCounts = () => keyTrackers.forEach((keyTracker, index) => console.log(`${index}. count --> ${keyTracker.count}`))
showCounts()

keyTrackers.forEach((keyTracker, index) => keyTracker.more(10))
showCounts()




