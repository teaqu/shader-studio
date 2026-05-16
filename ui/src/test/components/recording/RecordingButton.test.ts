import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import RecordingButton from '../../../lib/components/recording/RecordingButton.svelte';

describe('RecordingButton', () => {
  let defaultProps: any;

  beforeEach(() => {
    defaultProps = {
      hasShader: true,
      isRecording: false,
    };
  });

  it('should render camera button', () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record');
    expect(button).toBeInTheDocument();
    const icon = button!.querySelector('.codicon-device-camera');
    expect(icon).toBeInTheDocument();
  });

  it('camera button should be disabled when hasShader is false', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, hasShader: false } });
    const button = container.querySelector('.collapse-record');
    expect(button).toBeDisabled();
  });

  it('camera button should be enabled when hasShader is true', () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record');
    expect(button).not.toBeDisabled();
  });

  it('should show recording indicator when isRecording is true', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, isRecording: true } });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('should not show recording indicator when isRecording is false', () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).not.toBeInTheDocument();
  });

  it('should apply recording class when isRecording is true', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, isRecording: true } });
    const button = container.querySelector('.collapse-record');
    expect(button).toHaveClass('recording');
  });

  it('should apply active class when isActive is true', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, isActive: true } });
    const button = container.querySelector('.collapse-record');
    expect(button).toHaveClass('active');
  });

  it('should not apply active class when isActive is false', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, isActive: false } });
    const button = container.querySelector('.collapse-record');
    expect(button).not.toHaveClass('active');
  });

  it('should call onToggle when button is clicked', async () => {
    const onToggle = vi.fn();
    const { container } = render(RecordingButton, { props: { ...defaultProps, onToggle } });
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('should call onToggle on each click', async () => {
    const onToggle = vi.fn();
    const { container } = render(RecordingButton, { props: { ...defaultProps, onToggle } });
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

});
