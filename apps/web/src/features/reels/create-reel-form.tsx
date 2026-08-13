'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { MAX_VIDEO_UPLOAD_BYTES, SUPPORTED_VIDEO_MIME_TYPES } from '@instaclone/api-contracts';

import {
  finalizeMediaUpload,
  initializeMediaUpload,
  uploadFileDirectly,
  waitForReadyMedia,
} from '../../entities/media/api';
import { createReel } from '../../entities/reel/api';
import { getCsrfToken } from '../../lib/identity-api';
import { reelsQueryKey } from './use-reels';

type Stage = 'idle' | 'authorizing' | 'uploading' | 'processing' | 'publishing';

export function CreateReelForm({ emailVerified }: { emailVerified: boolean }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pending = stage !== 'idle';

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const selectFile = (selected: File | undefined) => {
    setError(null);
    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!SUPPORTED_VIDEO_MIME_TYPES.some((type) => type === selected.type)) {
      setError('Choose an MP4 or QuickTime video.');
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError('The source video must be no larger than 150 MB.');
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || pending || !emailVerified) return;
    const form = event.currentTarget;
    const captionValue = new FormData(form).get('caption');
    const caption = typeof captionValue === 'string' ? captionValue : '';
    setError(null);
    setProgress(0);
    try {
      setStage('authorizing');
      const csrfToken = await getCsrfToken();
      const upload = await initializeMediaUpload(
        {
          kind: 'VIDEO',
          mimeType: file.type as (typeof SUPPORTED_VIDEO_MIME_TYPES)[number],
          sizeBytes: file.size,
        },
        csrfToken,
      );
      setStage('uploading');
      await uploadFileDirectly(upload.upload, file, setProgress);
      setStage('processing');
      await finalizeMediaUpload(upload.media.id, csrfToken);
      await waitForReadyMedia(upload.media.id, 120, 2_000);
      setStage('publishing');
      await createReel({ mediaAssetId: upload.media.id, caption }, csrfToken);
      await queryClient.invalidateQueries({ queryKey: reelsQueryKey });
      setFile(null);
      setPreviewUrl(null);
      form.reset();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Reel creation failed');
    } finally {
      setStage('idle');
    }
  };

  return (
    <section className="createReel" aria-labelledby="create-reel-title">
      <p className="eyebrow">Reels · Phase 10</p>
      <h2 id="create-reel-title">Create a Reel</h2>
      <form className="identityForm" onSubmit={(event) => void submit(event)}>
        <label>
          Video
          <input
            type="file"
            accept={SUPPORTED_VIDEO_MIME_TYPES.join(',')}
            required
            disabled={pending || !emailVerified}
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        {previewUrl ? <video className="mediaPreview" src={previewUrl} muted controls /> : null}
        <label>
          Caption
          <textarea name="caption" maxLength={2200} rows={3} disabled={pending} />
        </label>
        {stage === 'uploading' ? <progress value={progress} max={100} /> : null}
        {pending ? <p role="status">{stageLabel(stage)}</p> : null}
        {error ? (
          <p className="formError" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={!file || pending || !emailVerified}>
          {pending ? 'Creating…' : 'Create Reel'}
        </button>
      </form>
    </section>
  );
}

const stageLabel = (stage: Stage): string =>
  ({
    idle: '',
    authorizing: 'Preparing direct upload…',
    uploading: 'Uploading to object storage…',
    processing: 'Validating and transcoding video…',
    publishing: 'Publishing Reel…',
  })[stage];
