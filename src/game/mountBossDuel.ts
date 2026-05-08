import { ThreeBossDuel } from "./ThreeBossDuel";

export function mountBossDuel(parent: string) {
  const element = document.getElementById(parent);
  if (!element) {
    throw new Error(`Missing game mount element: ${parent}`);
  }
  const game = new ThreeBossDuel(element);

  return () => {
    game.destroy();
  };
}
