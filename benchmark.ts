import { performance } from "perf_hooks";

const ITERATIONS = 100000;

function runBench() {
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    sum += Math.sqrt(i) * Math.random();
  }
  const end = performance.now();
  console.log(`Ran ${ITERATIONS} iterations in ${(end - start).toFixed(3)}ms`);
}

runBench();
