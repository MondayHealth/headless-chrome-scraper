
export function l(statement, op) {
  console.log(`${new Date()} ${op ? op : "-"} ${statement}`);
}

export function e(statement) {
  console.error(`${new Date()} ! ${statement}`);
}