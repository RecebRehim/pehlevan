export const cameraKick = { current: 0 };

export function punchCamera(amount: number) {
  cameraKick.current = Math.max(cameraKick.current, amount);
}
