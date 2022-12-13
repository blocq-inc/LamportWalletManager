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