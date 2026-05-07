import Phaser from "phaser";
import { BossDuelScene } from "./BossDuelScene";

export function mountBossDuel(parent: string) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1200,
    height: 720,
    backgroundColor: "#111312",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
      default: "arcade"
    },
    scene: [BossDuelScene],
    input: {
      mouse: {
        preventDefaultWheel: true
      }
    }
  });

  return () => {
    game.destroy(true);
  };
}
