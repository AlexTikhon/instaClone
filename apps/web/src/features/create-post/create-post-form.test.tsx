import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreatePostForm } from './create-post-form';

const api = vi.hoisted(() => ({
  getCsrfToken: vi.fn(),
  initializeMediaUpload: vi.fn(),
  uploadFileDirectly: vi.fn(),
  finalizeMediaUpload: vi.fn(),
  waitForReadyMedia: vi.fn(),
  createPost: vi.fn(),
}));

vi.mock('../../lib/identity-api', () => ({ getCsrfToken: api.getCsrfToken }));
vi.mock('../../entities/media/api', () => ({
  initializeMediaUpload: api.initializeMediaUpload,
  uploadFileDirectly: api.uploadFileDirectly,
  finalizeMediaUpload: api.finalizeMediaUpload,
  waitForReadyMedia: api.waitForReadyMedia,
}));
vi.mock('../../entities/post/api', () => ({ createPost: api.createPost }));

describe('CreatePostForm', () => {
  beforeEach(() => {
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn().mockReturnValue('blob:preview') },
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
    api.createPost.mockResolvedValue({
      id: 'b890bc98-c864-45de-aa46-d3f439e5ed87',
      author: {
        userId: '8f5692da-37a3-46e4-9ea3-a4d4db9b1710',
        username: 'ada',
        displayName: 'Ada',
        bio: '',
        websiteUrl: null,
        isPrivate: false,
      },
      caption: 'A real post',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      media: [{ url: 'https://storage.example/thumb', position: 0 }],
    });
  });

  it('uploads, waits for processing, prevents duplicate submission, and renders the post', async () => {
    api.getCsrfToken.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('csrf'), 20)),
    );
    render(<CreatePostForm emailVerified />);
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Image'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A real post' } });
    const submit = screen.getByRole('button', { name: 'Create post' });
    const form = submit.closest('form');
    if (!form) throw new Error('Create post form not found');
    fireEvent.submit(form);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByLabelText('Created post')).toBeInTheDocument());
    expect(api.initializeMediaUpload).toHaveBeenCalledTimes(1);
    expect(api.createPost).toHaveBeenCalledWith(
      { caption: 'A real post', mediaAssetIds: ['819f0ae1-e33d-4f1f-b318-c65fa2620116'] },
      'csrf',
    );
  });

  it('keeps publishing disabled for an unverified account', () => {
    render(<CreatePostForm emailVerified={false} />);
    expect(screen.getByText('Verify your email before publishing media.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create post' })).toBeDisabled();
  });
});
