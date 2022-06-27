import BigNumber from "bignumber.js"

export const percentageChange = (numX: BigNumber, numY: BigNumber): string => {
    return numX.isEqualTo(0) || numY.isEqualTo(0) ? "0.00" : numY.minus(numX).dividedBy(numX).multipliedBy(100).toFixed(2);
}