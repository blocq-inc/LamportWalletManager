import LamportWalletManager from "./LamportWalletManager"

import { LamportKeyPair, RandPair, PubPair, KeyPair, Sig } from './types'
import { unzipN, startTimer, deepFreeze, df, cpylck, hash, hash_b, pubFromPri, verify_signed_hash, mk_key_pair, sign_hash, is_private_key } from './functions'

export default LamportWalletManager
export { LamportKeyPair, RandPair, PubPair, KeyPair, Sig, unzipN, startTimer, deepFreeze, df, cpylck, hash, hash_b, pubFromPri, verify_signed_hash, mk_key_pair, sign_hash, is_private_key }
