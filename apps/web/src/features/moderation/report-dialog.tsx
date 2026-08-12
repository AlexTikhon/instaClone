'use client';

import { useState, type FormEvent } from 'react';

import {
  MAX_REPORT_DETAILS_LENGTH,
  type CreateReportInput,
  type ModerationTargetType,
  type ReportReason,
} from '@instaclone/api-contracts';

import { createReport } from '../../entities/moderation/api';

const reasons: readonly { value: ReportReason; label: string }[] = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'HATE_OR_ABUSE', label: 'Hate or abuse' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual content' },
  { value: 'VIOLENCE', label: 'Violence' },
  { value: 'IMPERSONATION', label: 'Impersonation' },
  { value: 'SCAM', label: 'Scam' },
  { value: 'OTHER', label: 'Other' },
];

export const submitReportSafely = async (
  input: CreateReportInput,
  reporter: (command: CreateReportInput) => Promise<unknown> = createReport,
): Promise<boolean> => {
  try {
    await reporter(input);
    return true;
  } catch {
    return false;
  }
};

export function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  onClose,
  submitReport = submitReportSafely,
}: {
  targetType: ModerationTargetType;
  targetId: string;
  targetLabel: string;
  onClose: () => void;
  submitReport?: (command: CreateReportInput) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [submissionFailed, setSubmissionFailed] = useState(false);
  const [status, setStatus] = useState<'IDLE' | 'PENDING' | 'SUCCESS'>('IDLE');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason) return;
    setSubmissionFailed(false);
    setStatus('PENDING');
    const detailsValue = new FormData(event.currentTarget).get('details');
    const details = typeof detailsValue === 'string' ? detailsValue.trim() : '';
    const succeeded = await submitReport({
      targetType,
      targetId,
      reason,
      ...(details ? { details } : {}),
    });
    if (succeeded) {
      setStatus('SUCCESS');
    } else {
      setSubmissionFailed(true);
      setStatus('IDLE');
    }
  };

  return (
    <div className="dialogBackdrop" role="presentation">
      <section
        className="reportDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
      >
        {status === 'SUCCESS' ? (
          <>
            <h2 id="report-dialog-title">Report received</h2>
            <p>Thank you. The moderation team can now review {targetLabel}.</p>
            <button type="button" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <h2 id="report-dialog-title">Report {targetLabel}</h2>
            <label htmlFor={`report-reason-${targetId}`}>Reason</label>
            <select
              id={`report-reason-${targetId}`}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value as ReportReason | '')}
            >
              <option value="">Choose a reason</option>
              {reasons.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <label htmlFor={`report-details-${targetId}`}>Additional details (optional)</label>
            <textarea
              id={`report-details-${targetId}`}
              name="details"
              maxLength={MAX_REPORT_DETAILS_LENGTH}
              rows={4}
            />
            {submissionFailed ? (
              <p className="formError" role="alert">
                The report could not be submitted. It may already be under review.
              </p>
            ) : null}
            <div className="dialogActions">
              <button type="button" className="secondaryButton" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={!reason || status === 'PENDING'}>
                {status === 'PENDING' ? 'Submitting...' : 'Submit report'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
