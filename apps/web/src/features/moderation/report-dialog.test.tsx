import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportDialog } from './report-dialog';

const moderationApi = vi.hoisted(() => ({ createReport: vi.fn() }));
vi.mock('../../entities/moderation/api', () => ({ createReport: moderationApi.createReport }));

const renderDialog = (onClose = vi.fn(), submitReport?: (command: unknown) => Promise<boolean>) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReportDialog
        targetType="POST"
        targetId="10000000-0000-4000-8000-000000000001"
        targetLabel="post"
        onClose={onClose}
        {...(submitReport ? { submitReport } : {})}
      />
    </QueryClientProvider>,
  );
  return onClose;
};

describe('ReportDialog', () => {
  beforeEach(() => moderationApi.createReport.mockReset());

  it('requires a reason and confirms a successful bounded report', async () => {
    moderationApi.createReport.mockResolvedValue({
      reportId: '20000000-0000-4000-8000-000000000001',
      status: 'RECEIVED',
    });
    const onClose = renderDialog();
    const submit = screen.getByRole('button', { name: 'Submit report' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'SPAM' } });
    fireEvent.change(screen.getByLabelText('Additional details (optional)'), {
      target: { value: 'Repeated synthetic promotion' },
    });
    fireEvent.click(submit);
    await screen.findByText('Report received');
    expect(moderationApi.createReport).toHaveBeenCalledWith({
      targetType: 'POST',
      targetId: '10000000-0000-4000-8000-000000000001',
      reason: 'SPAM',
      details: 'Repeated synthetic promotion',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('retains the form and surfaces API failure', async () => {
    renderDialog(vi.fn(), () => Promise.resolve(false));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'OTHER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('could not be submitted'),
    );
    expect(screen.getByLabelText('Reason')).toHaveValue('OTHER');
  });
});
