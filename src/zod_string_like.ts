import { z, ZodType } from "./zod.ts";

export function zsNumber<T extends ZodType>(underlying: T) {
  return z.preprocess((arg) => {
    if (typeof arg === "string") {
      return parseFloat(arg);
    }
    return arg;
  }, underlying);
}

export function zsBigInt<T extends ZodType>(underlying: T) {
  return z.preprocess((arg) => {
    if (typeof arg === "string") {
      return BigInt(arg);
    }
    return arg;
  }, underlying);
}

export function zsBoolean<T extends ZodType>(underlying: T) {
  return z
    .preprocess((arg) => {
      if (typeof arg === "string") {
        if (arg === "true") return true;
        if (arg === "false") return false;
      }
      return arg;
    }, underlying);
}

export function zsDate<T extends ZodType>(underlying: T) {
  return z
    .preprocess((arg) => {
      if (typeof arg === "string") return new Date(arg);
      return arg;
    }, underlying);
}
