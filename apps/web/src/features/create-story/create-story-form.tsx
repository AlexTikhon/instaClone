'use client';

import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { MAX_IMAGE_UPLOAD_BYTES, SUPPORTED_IMAGE_MIME_TYPES } from '@instaclone/api-contracts';

import {
  finalizeMediaUpload,
  initializeMediaUpload,
  uploadFileDirectly,
  waitForReadyMedia,
} from '../../entities/media/api';
import { createStory } from '../../entities/story/api';
import { getCsrfToken } from '../../lib/identity-api';
import { queryKeys } from '../feed/query-keys';

interface CreateStoryFormProps {
  emailVerified: boolean;
}
type Stage = 'idle' | 'authorizing' | 'uploading' | 'processing' | 'publishing';

export function CreateStoryForm({ emailVerified }: CreateStoryFormProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const pending = stage !== 'idle';

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const selectFile = (selected: File | undefined) => {
    setError(null);
    setCreated(false);
    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!SUPPORTED_IMAGE_MIME_TYPES.some((type) => type === selected.type)) {
      setError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_IMAGE_UPLOAD_BYTES) {
      setError('The image must be no larger than 10 MB.');
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || pending || !emailVerified) return;
    const form = event.currentTarget;
    setError(null);
    setCreated(false);
    setProgress(0);
    try {
      setStage('authorizing');
      const csrfToken = await getCsrfToken();
      const upload = await initializeMediaUpload(
        {
          kind: 'IMAGE',
          mimeType: file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number],
          sizeBytes: file.size,
        },
        csrfToken,
      );
      setStage('uploading');
      await uploadFileDirectly(upload.upload, file, setProgress);
      setStage('processing');
      await finalizeMediaUpload(upload.media.id, csrfToken);
      await waitForReadyMedia(upload.media.id);
      setStage('publishing');
      await createStory({ mediaAssetId: upload.media.id }, csrfToken);
      await queryClient.invalidateQueries({ queryKey: queryKeys.stories });
      setCreated(true);
      setFile(null);
      setPreviewUrl(null);
      form.reset();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Story creation failed',
      );
    } finally {
      setStage('idle');
    }
  };

  return (
    <section className="createStory" aria-labelledby="create-story-title">
      <p className="eyebrow">Stories · Phase 6</p>
      <h2 id="create-story-title">Create a 24-hour Story</h2>
      {!emailVerified ? (
        <p className="formError">Verify your email before publishing media.</p>
      ) : null}
      <form className="identityForm" onSubmit={(event) => void submit(event)}>
        <label>
          Image
          <input
            type="file"
            accept={SUPPORTED_IMAGE_MIME_TYPES.join(',')}
            required
            disabled={pending || !emailVerified}
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        {previewUrl ? (
          <Image
            className="mediaPreview"
            src={previewUrl}
            alt="Selected Story preview"
            width={640}
            height={800}
            unoptimized
          />
        ) : null}
        {stage === 'uploading' ? (
          <progress value={progress} max={100}>
            {progress}%
          </progress>
        ) : null}
        {pending ? <p role="status">{stage}…</p> : null}
        {error ? (
          <p className="formError" role="alert">
            {error}
          </p>
        ) : null}
        {created ? <p role="status">Your Story is live.</p> : null}
        <button type="submit" disabled={!file || pending || !emailVerified}>
          {pending ? 'Creating…' : 'Create Story'}
        </button>
      </form>
    </section>
  );
}
