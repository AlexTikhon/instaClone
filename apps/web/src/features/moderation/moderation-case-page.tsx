'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import type { ModerationDecisionAction } from '@instaclone/api-contracts';

import {
  findModerationCase,
  resolveModerationCase,
  startModerationReview,
} from '../../entities/moderation/api';
import { useAuth } from '../auth/auth-provider';

export function ModerationCasePage({ caseId }: { caseId: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [action, setAction] = useState<ModerationDecisionAction>('NO_ACTION');
  const privileged = user?.role === 'MODERATOR' || user?.role === 'ADMIN';
  const queryKey = ['moderation', 'case', caseId] as const;
  const moderationCase = useQuery({
    queryKey,
    queryFn: () => findModerationCase(caseId),
    enabled: privileged,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: ['moderation', 'cases'] }),
    ]);
  };
  const start = useMutation({
    mutationFn: () => startModerationReview(caseId),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: ({ decision, note }: { decision: ModerationDecisionAction; note?: string }) =>
      resolveModerationCase(caseId, decision, note),
    onSuccess: refresh,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('internalNote');
    const note = typeof value === 'string' ? value.trim() : '';
    resolve.mutate({ decision: action, ...(note ? { note } : {}) });
  };

  if (!privileged)
    return <section className="discoveryState">Moderator access is required.</section>;
  if (moderationCase.isPending) return <section className="discoveryState">Loading case…</section>;
  if (moderationCase.isError)
    return <section className="discoveryState">Case unavailable.</section>;
  const detail = moderationCase.data;
  const firstSnapshot = detail.reports[0]?.snapshot;
  return (
    <section className="moderationPage" aria-labelledby="moderation-case-title">
      <Link href="/moderation">← All cases</Link>
      <header>
        <p className="eyebrow">{detail.status.replace('_', ' ')}</p>
        <h1 id="moderation-case-title">{detail.targetType} case</h1>
        <code>{detail.targetId}</code>
      </header>
      <dl className="caseMetadata">
        <div>
          <dt>Reports</dt>
          <dd>{detail.reportCount}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>@{firstSnapshot?.username ?? 'retained evidence'}</dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>{detail.reviewerId ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      {firstSnapshot?.text ? (
        <article className="evidencePreview">
          <h2>Evidence preview</h2>
          <p>{firstSnapshot.text}</p>
        </article>
      ) : null}
      <section>
        <h2>Reports</h2>
        <ul className="moderationReports">
          {detail.reports.map((report) => (
            <li key={report.id}>
              <strong>{report.reason.replaceAll('_', ' ')}</strong>
              <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
              {report.details ? <p>{report.details}</p> : null}
              <small>Reporter {report.reporterId}</small>
            </li>
          ))}
        </ul>
        {detail.reportsTruncated ? <p>Only the first 50 reports are shown.</p> : null}
      </section>
      <section>
        <h2>Audit history</h2>
        {detail.audit.length === 0 ? (
          <p>No privileged changes yet.</p>
        ) : (
          <ol className="auditList">
            {detail.audit.map((entry) => (
              <li key={entry.id}>
                {entry.action.replaceAll('_', ' ')} · {new Date(entry.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
        )}
      </section>
      {detail.status === 'OPEN' ? (
        <button type="button" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : 'Start review'}
        </button>
      ) : null}
      {detail.status !== 'CLOSED' ? (
        <form className="moderationDecision" onSubmit={submit}>
          <h2>Decision</h2>
          <label htmlFor="moderation-action">Action</label>
          <select
            id="moderation-action"
            value={action}
            onChange={(event) => setAction(event.target.value as ModerationDecisionAction)}
          >
            <option value="NO_ACTION">No action</option>
            {detail.targetType !== 'USER' ? (
              <option value="REMOVE_CONTENT">Remove content</option>
            ) : null}
            {detail.targetType === 'USER' && user?.role === 'ADMIN' ? (
              <option value="SUSPEND_ACCOUNT">Suspend account</option>
            ) : null}
          </select>
          <label htmlFor="moderator-note">Private note (optional)</label>
          <textarea id="moderator-note" name="internalNote" maxLength={2000} rows={5} />
          {start.isError || resolve.isError ? (
            <p className="formError" role="alert">
              The moderation change failed.
            </p>
          ) : null}
          <button type="submit" disabled={resolve.isPending}>
            {resolve.isPending ? 'Resolving…' : 'Resolve case'}
          </button>
        </form>
      ) : detail.decision ? (
        <section className="evidencePreview">
          <h2>Decision</h2>
          <p>{detail.decision.action.replaceAll('_', ' ')}</p>
          {detail.decision.internalNote ? <p>{detail.decision.internalNote}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
