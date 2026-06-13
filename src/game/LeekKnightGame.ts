import Phaser from 'phaser'
import { RideScene } from './RideScene'
import type { HudState, RunResult, SettlementPoint, StockDataset } from '../types'

export interface GameCallbacks {
  onHud: (state: HudState) => void
  onSettle: (point: SettlementPoint, balance: number, previousBalance?: number) => void
  onRespawn: () => void
  onEnd: (result: RunResult) => void
  onEngine: (speed: number) => void
  onSound: (kind: 'gain' | 'loss' | 'land' | 'crash' | 'finish', combo?: number) => void
  onComboBreak?: () => void
}

export class LeekKnightGame {
  private game: Phaser.Game | null = null
  private stock: StockDataset
  private amount: number
  private callbacks: GameCallbacks

  constructor(stock: StockDataset, amount: number, callbacks: GameCallbacks) {
    this.stock = stock
    this.amount = amount
    this.callbacks = callbacks
    this.create()
  }

  restart(): void {
    this.destroy()
    this.create()
  }

  destroy(): void {
    this.game?.destroy(true)
    this.game = null
  }

  private create(): void {
    const scene = new RideScene({ stock: this.stock, initialAmount: this.amount, ...this.callbacks })
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-root',
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#080a0d',
      physics: {
        default: 'matter',
        matter: {
          gravity: { x: 0, y: 1.05 },
          enableSleeping: false,
          positionIterations: 8,
          velocityIterations: 6,
          constraintIterations: 4,
        },
      },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: true, roundPixels: false },
      scene,
    })
  }
}
