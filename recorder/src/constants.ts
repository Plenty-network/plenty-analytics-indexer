import BigNumber from "bignumber.js";

export const ZERO_VAL = new BigNumber(0);
export const V2_SWAP_ENTRYPOINTS = ["Swap", "ctez_to_tez", "tez_to_ctez"];
export const V3_SWAP_ENTRYPOINTS = ["x_to_y", "y_to_x"];
export const V2_ADD_LIQUIDITY_ENTRYPOINTS = ["add_liquidity", "AddLiquidity"];
export const V3_LIQUIDITY_ENTRYPOINTS = ["set_position", "update_position"];
export const V2_REMOVE_LIQUIDITY_ENTRYPOINTS = ["remove_liquidity", "RemoveLiquidity"];
export const TXN_ENTRYPOINTS = [
  ...V2_SWAP_ENTRYPOINTS,
  ...V2_ADD_LIQUIDITY_ENTRYPOINTS,
  ...V2_REMOVE_LIQUIDITY_ENTRYPOINTS,
  ...V3_SWAP_ENTRYPOINTS,
  ...V3_LIQUIDITY_ENTRYPOINTS,
];
export const V3_SET_POSITION = "set_position";
export const V3_UPDATE_POSITION = "update_position";
export const V3_SWAP_X_TO_Y = "x_to_y";
export const V3_SWAP_Y_TO_X = "y_to_x";
export const TEZ_SWAP_ENTRYPOINT = "tez_to_ctez";
export const CTEZ_SWAP_ENTRYPOINT = "ctez_to_tez";
export const PRICING_TREE = [["USDt", "USDC.e"], ["ctez"], ["uUSD", "kUSD"], ["YOU"], ["uXTZ"], ["uXAU"]];
