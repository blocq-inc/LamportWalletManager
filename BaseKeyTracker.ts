import { ethers } from "ethers";
import { KeyPair, PubPair } from "./types";

/**
 * @name BaseKeyTracker
 * @description abstract and static functions for key trackers
 * @date March 28th 2023
 * @author William Doyle
 */
export default abstract class BaseKeyTracker {
    abstract get count(): number;
    abstract more(amount: number): KeyPair[];
    abstract getOne(): KeyPair; 
    abstract getN(amount: number): KeyPair[];

    static pkhFromPublicKey(pub: PubPair[]): string {
        return ethers.utils.keccak256(ethers.utils.solidityPack(['bytes32[2][256]'], [pub])) 
    }
}