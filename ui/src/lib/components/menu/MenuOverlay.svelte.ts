import { computeMenuPos, type MenuSide } from "../../utils/menuPos";

export class MenuOverlay {
  open = $state(false);
  element = $state<HTMLElement | null>(null);
  trigger = $state<HTMLElement | null>(null);
  position = $state({ top: 0, left: 0 });
  visible = $state(false);
  private readonly disposeEffect: () => void;

  constructor(private readonly side: MenuSide) {
    this.disposeEffect = $effect.root(() => {
      $effect(() => {
        if (!this.open) {
          this.visible = false;
          return;
        }

        if (this.element && this.trigger) {
          this.position = computeMenuPos(this.trigger, this.element, this.side);
          this.visible = true;
        }
      });
    });
  }

  toggle() {
    this.open = !this.open;
  }

  close() {
    this.open = false;
  }

  dispose() {
    this.disposeEffect();
  }

  contains(target: HTMLElement | null) {
    return Boolean(target && this.element?.contains(target));
  }
}
