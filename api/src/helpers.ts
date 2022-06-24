import BigNumber from "bignumber.js"

export const percentageChange = (numX: BigNumber, numY: BigNumber): string => {
    return numY.minus(numX).dividedBy(numX).multipliedBy(100).toFixed(2);
}