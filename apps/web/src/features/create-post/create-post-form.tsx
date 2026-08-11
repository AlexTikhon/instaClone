'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';

import {
  MAX_IMAGE_UPLOAD_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type PostResponse,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import {
  finalizeMediaUpload,
  initializeMediaUpload,
  uploadFileDirectly,
  waitForReadyMedia,
} from '../../entities/media/api';
import { createPost } from '../../entities/post/api';

interface CreatePostFormProps {
  emailVerified: boolean;
}

type WorkflowStage = 'idle' | 'authorizing' | 'uploading' | 'processing' | 'publishing';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Post creation failed';

export function CreatePostForm({ emailVerified }: CreatePostFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<WorkflowStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [createdPost, setCreatedPost] = useState<PostResponse | null>(null);
  const pending = stage !== 'idle';

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectFile = (selected: File | undefined) => {
    setError(null);
    setCreatedPost(null);
    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!SUPPORTED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === selected.type)) {
      setError('Choose a JPEG, PNG, or WebP image.');
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_IMAGE_UPLOAD_BYTES) {
      setError('The image must be no larger than 10 MB.');
      setFile(null);
      setPreviewUrl(null);
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
    setCreatedPost(null);
    setProgress(0);
    try {
      setStage('authorizing');
      const csrfToken = await getCsrfToken();
      const initialization = await initializeMediaUpload(
        {
          kind: 'IMAGE',
          mimeType: file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number],
          sizeBytes: file.size,
        },
        csrfToken,
      );
      setStage('uploading');
      await uploadFileDirectly(initialization.upload, file, setProgress);
      setStage('processing');
      await finalizeMediaUpload(initialization.media.id, csrfToken);
      await waitForReadyMedia(initialization.media.id);
      setStage('publishing');
      const post = await createPost(
        { caption, mediaAssetIds: [initialization.media.id] },
        csrfToken,
      );
      setCreatedPost(post);
      setFile(null);
      setPreviewUrl(null);
      form.reset();
    } catch (submissionError) {
      setError(errorMessage(submissionError));
    } finally {
      setStage('idle');
    }
  };

  return (
    <section className="createPost" aria-labelledby="create-post-title">
      <p className="eyebrow">Media + Posts · Phase 3</p>
      <h2 id="create-post-title">Create an image post</h2>
      {!emailVerified && <p className="formError">Verify your email before publishing media.</p>}
      <form className="identityForm" onSubmit={(event) => void submit(event)}>
        <label>
          Image
          <input
            name="image"
            type="file"
            accept={SUPPORTED_IMAGE_MIME_TYPES.join(',')}
            required
            disabled={pending || !emailVerified}
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        {previewUrl && (
          <Image
            className="mediaPreview"
            src={previewUrl}
            alt="Selected image preview"
            width={640}
            height={640}
            unoptimized
          />
        )}
        <label>
          Caption
          <textarea name="caption" maxLength={2200} rows={4} disabled={pending} />
        </label>
        {stage === 'uploading' && (
          <label>
            Upload progress
            <progress value={progress} max={100}>
              {progress}%
            </progress>
          </label>
        )}
        {pending && <p role="status">{stageLabel(stage)}</p>}
        {error && (
          <p className="formError" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={!file || pending || !emailVerified}>
          {pending ? 'Creating…' : 'Create post'}
        </button>
      </form>
      {createdPost && (
        <article className="createdPost" aria-label="Created post">
          {createdPost.media[0]?.url && (
            <Image
              src={createdPost.media[0].url}
              alt={createdPost.caption || 'Created post image'}
              width={640}
              height={640}
              unoptimized
            />
          )}
          <p>
            <strong>@{createdPost.author.username}</strong> {createdPost.caption}
          </p>
        </article>
      )}
    </section>
  );
}

const stageLabel = (stage: WorkflowStage): string => {
  const labels: Record<WorkflowStage, string> = {
    idle: '',
    authorizing: 'Authorizing upload…',
    uploading: 'Uploading directly to object storage…',
    processing: 'Checking and processing image…',
    publishing: 'Publishing post…',
  };
  return labels[stage];
};
