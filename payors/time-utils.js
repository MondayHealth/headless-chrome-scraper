
export async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function jitterWait(min, jitter) {
  return wait(Math.ceil(Math.random() * jitter + min));
}
