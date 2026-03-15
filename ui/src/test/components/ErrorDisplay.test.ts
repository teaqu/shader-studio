import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import ErrorDisplay from '../../lib/components/ErrorDisplay.svelte';

describe('ErrorDisplay', () => {
  describe('visibility', () => {
    it('should not render when isVisible is false', () => {
      const { container } = render(ErrorDisplay, {
        props: { errors: ['some error'], isVisible: false },
      });
      expect(container.querySelector('.error-overlay')).toBeNull();
    });

    it('should not render when errors array is empty', () => {
      const { container } = render(ErrorDisplay, {
        props: { errors: [], isVisible: true },
      });
      expect(container.querySelector('.error-overlay')).toBeNull();
    });

    it('should not render when both isVisible is false and errors is empty', () => {
      const { container } = render(ErrorDisplay, {
        props: { errors: [], isVisible: false },
      });
      expect(container.querySelector('.error-overlay')).toBeNull();
    });

    it('should render when isVisible is true and errors are present', () => {
      const { container } = render(ErrorDisplay, {
        props: { errors: ['an error'], isVisible: true },
      });
      expect(container.querySelector('.error-overlay')).toBeTruthy();
    });
  });

  describe('error messages', () => {
    it('should display a single error message', () => {
      render(ErrorDisplay, {
        props: { errors: ['Something went wrong'], isVisible: true },
      });
      const content = document.body.textContent ?? '';
      expect(content).toContain('Something went wrong');
    });

    it('should display multiple error messages', () => {
      render(ErrorDisplay, {
        props: {
          errors: ['First error', 'Second error', 'Third error'],
          isVisible: true,
        },
      });
      const content = document.body.textContent ?? '';
      expect(content).toContain('First error');
      expect(content).toContain('Second error');
      expect(content).toContain('Third error');
    });

    it('should render one error-message element per error', () => {
      render(ErrorDisplay, {
        props: {
          errors: ['err1', 'err2', 'err3'],
          isVisible: true,
        },
      });
      const messages = document.querySelectorAll('.error-message');
      expect(messages.length).toBe(3);
    });

    it('should display the heading "Error"', () => {
      render(ErrorDisplay, {
        props: { errors: ['test'], isVisible: true },
      });
      const heading = document.querySelector('h3');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toBe('Error');
    });
  });

  describe('dismiss', () => {
    it('should render a dismiss button', () => {
      render(ErrorDisplay, {
        props: { errors: ['test'], isVisible: true },
      });
      const button = document.querySelector('.error-dismiss');
      expect(button).toBeTruthy();
      expect(button?.textContent).toBe('Dismiss');
    });

    it('should call onDismiss when dismiss button is clicked', async () => {
      const onDismiss = vi.fn();
      render(ErrorDisplay, {
        props: { errors: ['test'], isVisible: true, onDismiss },
      });
      const button = document.querySelector('.error-dismiss') as HTMLElement;
      await fireEvent.click(button);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should not throw when dismiss is clicked without onDismiss prop', async () => {
      render(ErrorDisplay, {
        props: { errors: ['test'], isVisible: true },
      });
      const button = document.querySelector('.error-dismiss') as HTMLElement;
      await expect(fireEvent.click(button)).resolves.not.toThrow();
    });
  });

  describe('default props', () => {
    it('should default to not visible with no errors', () => {
      const { container } = render(ErrorDisplay);
      expect(container.querySelector('.error-overlay')).toBeNull();
    });
  });
});
