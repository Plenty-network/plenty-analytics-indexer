export const convertToMap = (arr: any[], key: string): any => {
  const res: { [key: string]: any } = {};
  for (const item of arr) {
    res[`${item[`${key}`]}`] = item;
  }
  return res;
};

export const percentageChange = (open: number, close: number): string => {
  if (open === 0 && close === 0) {
    return "0.00";
  } else if (open === 0 && close !== 0) {
    return "100.00";
  } else {
    return (((close - open) / open) * 100).toFixed(2);
  }
};
