// A tiny feed-forward network: inputs -> 8 tanh hidden units -> outputs.
// The "memory" output is fed back as an input on the next tick.

export const INPUTS = [
  'energy', 'algae here', 'algae left', 'algae right',
  'other: near', 'other: side', 'other: ahead', 'other: size',
  'other: kin', 'other: diet', 'wall ahead', 'memory', 'clock', 'hurt',
];
export const OUTPUTS = ['turn', 'thrust', 'attack', 'breed', 'memory'];

export const N_IN = INPUTS.length;
export const N_HID = 8;
export const N_OUT = OUTPUTS.length;

// Weight layout inside the flat genome array.
export const W1 = 0;
export const B1 = W1 + N_IN * N_HID;
export const W2 = B1 + N_HID;
export const B2 = W2 + N_HID * N_OUT;
export const N_WEIGHTS = B2 + N_OUT;

export class Brain {
  constructor(weights) {
    this.w = weights;
    this.input = new Float32Array(N_IN);
    this.hidden = new Float32Array(N_HID);
    this.output = new Float32Array(N_OUT);
  }

  think() {
    const { w, input, hidden, output } = this;
    for (let j = 0; j < N_HID; j++) {
      let s = w[B1 + j];
      const o = W1 + j * N_IN;
      for (let i = 0; i < N_IN; i++) s += w[o + i] * input[i];
      hidden[j] = Math.tanh(s);
    }
    for (let k = 0; k < N_OUT; k++) {
      let s = w[B2 + k];
      const o = W2 + k * N_HID;
      for (let j = 0; j < N_HID; j++) s += w[o + j] * hidden[j];
      output[k] = Math.tanh(s);
    }
    return output;
  }
}
