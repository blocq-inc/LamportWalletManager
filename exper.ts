const candidate = '0x4f171744973047296d90e7828676F4972faFB200' 

function isEthereumAddress(candidate: string) : boolean {
    if (candidate.length !== 42)  // check length
        return false

    if (candidate.slice(0, 2) !== '0x')  // check prefix
        return false
    
    const unprefixed = candidate.slice(2)
    const acceptableChars = '0123456789abcdefABCDEF'

    for (let i = 0; i < unprefixed.length; i++) 
        if (!acceptableChars.includes(unprefixed[i])) 
            return false

    return true
}

console.log(isEthereumAddress(candidate))