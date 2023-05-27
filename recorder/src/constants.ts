import BigNumber from "bignumber.js";

export const ZERO_VAL = new BigNumber(0);
export const SWAP_ENTRYPOINTS = ["Swap", "ctez_to_tez", "tez_to_ctez"];
export const ADD_LIQUIDITY_ENTRYPOINTS = ["add_liquidity", "AddLiquidity"];
export const REMOVE_LIQUIDITY_ENTRYPOINS = ["remove_liquidity", "RemoveLiquidity"];
export const TXN_ENTRYPOINTS = [...SWAP_ENTRYPOINTS, ...ADD_LIQUIDITY_ENTRYPOINTS, ...REMOVE_LIQUIDITY_ENTRYPOINS];
export const TEZ_SWAP_ENTRYPOINT = "tez_to_ctez";
export const CTEZ_SWAP_ENTRYPOINT = "ctez_to_tez";
export const PRICING_TREE = [["USDt", "USDC.e"], ["CTez"], ["uUSD", "kUSD"], ["YOU"]];
