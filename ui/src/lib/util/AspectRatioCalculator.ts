import { getAspectRatio, type AspectRatioMode } from "../stores/aspectRatioStore";
import { parseDimension } from "../stores/resolutionStore";

export interface CanvasDimensions {
    width: number;
    height: number;
}

export interface CalculationResult {
    visualWidth: number;
    visualHeight: number;
    renderWidth: number;
    renderHeight: number;
}

export class AspectRatioCalculator {
  constructor(
        private container: HTMLElement
  ) { }

  public calculate(
    aspectMode: AspectRatioMode,
    resolutionScale: number,
    zoomLevel: number,
    customWidth?: string,
    customHeight?: string,
  ): CalculationResult {
    const { width: containerWidth, height: containerHeight } = this.getContainerDimensions();

    // Custom resolution: resolve px or % values, fit aspect into container for visual
    if (customWidth && customHeight) {
      const scaleFactor = window.devicePixelRatio;
      const nativeW = containerWidth * scaleFactor;
      const nativeH = containerHeight * scaleFactor;
      const resolvedW = parseDimension(customWidth, nativeW);
      const resolvedH = parseDimension(customHeight, nativeH);

      if (resolvedW && resolvedH) {
        const customAspect = resolvedW / resolvedH;
        const { width: baseWidth, height: baseHeight } = this.calculateFixedAspectRatio(
          containerWidth,
          containerHeight,
          customAspect,
        );

        const visualWidth = baseWidth * zoomLevel;
        const visualHeight = baseHeight * zoomLevel;

        return {
          visualWidth,
          visualHeight,
          renderWidth: resolvedW,
          renderHeight: resolvedH,
        };
      }
    }

    const { width: baseWidth, height: baseHeight } = this.calculateAspectRatioDimensions(
      containerWidth,
      containerHeight,
      aspectMode
    );

    const visualWidth = baseWidth * zoomLevel;
    const visualHeight = baseHeight * zoomLevel;

    const scaleFactor = window.devicePixelRatio;

    const renderZoom = Math.min(zoomLevel, 1.0);
    const renderWidth = Math.floor(baseWidth * scaleFactor * resolutionScale * renderZoom);
    const renderHeight = Math.floor(baseHeight * scaleFactor * resolutionScale * renderZoom);

    return {
      visualWidth,
      visualHeight,
      renderWidth,
      renderHeight
    };
  }

  private getContainerDimensions(): CanvasDimensions {
    const styles = getComputedStyle(this.container);
    const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);

    return {
      width: this.container.clientWidth - paddingX,
      height: this.container.clientHeight
    };
  }

  private calculateAspectRatioDimensions(
    containerWidth: number,
    containerHeight: number,
    aspectMode: AspectRatioMode
  ): CanvasDimensions {
    const aspectRatio = getAspectRatio(aspectMode);

    if (aspectRatio === null) {
      return this.handleSpecialAspectModes(containerWidth, containerHeight, aspectMode);
    }

    return this.calculateFixedAspectRatio(containerWidth, containerHeight, aspectRatio);
  }

  private handleSpecialAspectModes(
    containerWidth: number,
    containerHeight: number,
    aspectMode: AspectRatioMode
  ): CanvasDimensions {
    if (aspectMode === 'fill') {
      return { width: containerWidth, height: containerHeight };
    }

    if (aspectMode === 'auto') {
      const screenAspect = window.screen.width / window.screen.height;
      return this.calculateFixedAspectRatio(containerWidth, containerHeight, screenAspect);
    }

    const fallbackAspect = 16 / 9;
    return this.calculateFixedAspectRatio(containerWidth, containerHeight, fallbackAspect);
  }

  private calculateFixedAspectRatio(
    containerWidth: number,
    containerHeight: number,
    aspectRatio: number
  ): CanvasDimensions {
    if (containerWidth / containerHeight > aspectRatio) {
      return {
        width: containerHeight * aspectRatio,
        height: containerHeight
      };
    } else {
      return {
        width: containerWidth,
        height: containerWidth / aspectRatio
      };
    }
  }
}
