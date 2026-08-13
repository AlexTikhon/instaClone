import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateReelForm } from './create-reel-form';

const api = vi.hoisted(() => ({
  getCsrfToken: vi.fn(),
  initializeMediaUpload: vi.fn(),
  uploadFileDirectly: vi.fn(),
  finalizeMediaUpload: vi.fn(),
  waitForReadyMedia: vi.fn(),
  createReel: vi.fn(),
}));

vi.mock('../../lib/identity-api', () => ({ getCsrfToken: api.getCsrfToken }));
vi.mock('../../entities/media/api', () => ({
  initializeMediaUpload: api.initializeMediaUpload,
  uploadFileDirectly: api.uploadFileDirectly,
  finalizeMediaUpload: api.finalizeMediaUpload,
  waitForReadyMedia: api.waitForReadyMedia,
}));
vi.mock('../../entities/reel/api', () => ({ createReel: api.createReel }));

const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateReelForm emailVerified />
    </QueryClientProvider>,
  );

describe('CreateReelForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn().mockReturnValue('blob:video') },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    api.getCsrfToken.mockResolvedValue('csrf');
    api.initializeMediaUpload.mockResolvedValue({
      media: { id: '819f0ae1-e33d-4f1f-b318-c65fa2620116' },
      upload: {
        url: 'http://storage/upload',
        method: 'PUT',
        headers: {},
        expiresAt: new Date().toISOString(),
      },
    });
    api.uploadFileDirectly.mockImplementation(
      (_upload: unknown, _file: unknown, progress: (value: number) => void) => {
        progress(100);
        return Promise.resolve();
      },
    );
    api.finalizeMediaUpload.mockResolvedValue({ status: 'UPLOADED' });
    api.waitForReadyMedia.mockResolvedValue({ status: 'READY' });
    api.createReel.mockResolvedValue({ id: crypto.randomUUID() });
  });

  it('uploads, waits for READY, and publishes only after video processing', async () => {
    renderForm();
    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Video'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A Reel' } });
    const form = screen.getByRole('button', { name: 'Create Reel' }).closest('form');
    if (!form) throw new Error('Create Reel form not found');
    fireEvent.submit(form);
    await waitFor(() => expect(api.createReel).toHaveBeenCalledOnce());
    expect(api.initializeMediaUpload).toHaveBeenCalledWith(
      { kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 3 },
      'csrf',
    );
    expect(api.waitForReadyMedia).toHaveBeenCalledBefore(api.createReel);
    expect(api.createReel).toHaveBeenCalledWith(
      { mediaAssetId: '819f0ae1-e33d-4f1f-b318-c65fa2620116', caption: 'A Reel' },
      'csrf',
    );
  });

  it('shows processing failure and never publishes', async () => {
    api.waitForReadyMedia.mockRejectedValueOnce(
      new Error('Media processing failed (INVALID_MEDIA).'),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText('Video'), {
      target: { files: [new File([new Uint8Array([1])], 'bad.mp4', { type: 'video/mp4' })] },
    });
    const form = screen.getByRole('button', { name: 'Create Reel' }).closest('form');
    if (!form) throw new Error('Create Reel form not found');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_MEDIA');
    expect(api.createReel).not.toHaveBeenCalled();
  });
});
