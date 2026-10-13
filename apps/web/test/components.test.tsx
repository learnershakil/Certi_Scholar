import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentViewer } from '@/components/DocumentViewer';
import { FieldList } from '@/components/FieldList';
import { EvaluationTree, StageTracker } from '@/components/Progress';
import { defaultValue, RuleBuilder } from '@/components/RuleBuilder';
import { ConfidenceMeter, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { ExtractedField, FactDefinition, RuleNode } from '@/lib/types';

afterEach(cleanup);

const field = (over: Partial<ExtractedField>): ExtractedField => ({
  _id: over.key ?? 'f',
  key: 'roll_number',
  label: 'Roll number',
  kind: 'id',
  value: '2410387',
  page: 0,
  bbox: [0.2, 0.1, 0.4, 0.15],
  confidence: { ocr: 0.97, pattern: 1, overall: 0.97, threshold: 0.85 },
  status: 'auto_accepted',
  ...over,
});

const FIELDS = [
  field({}),
  field({ key: 'percentage', label: 'Percentage', value: '88.20', bbox: [0.5, 0.6, 0.6, 0.62], confidence: { ocr: 0.62, pattern: 1, overall: 0.62, threshold: 0.9 }, status: 'needs_review' }),
  field({ key: 'board', label: 'Board', value: null, bbox: undefined, status: 'needs_review', confidence: { ocr: 0, pattern: 0, overall: 0, threshold: 0.85 } }),
];

describe('DocumentViewer bounding-box overlay', () => {
  it('positions each box from normalised coordinates', () => {
    render(<DocumentViewer src="/x.png" fields={FIELDS} onSelect={() => undefined} />);
    const box = screen.getByTestId('bbox-roll_number');
    expect(box.style.left).toBe('20%');
    expect(box.style.top).toBe('10%');
    expect(box.style.width).toBe('20%');
    expect(parseFloat(box.style.height)).toBeCloseTo(5);
    expect(screen.queryByTestId('bbox-board')).toBeNull(); // no source region, nothing drawn
  });

  it('marks low-confidence regions and the active field', () => {
    render(<DocumentViewer src="/x.png" fields={FIELDS} activeKey="roll_number" onSelect={() => undefined} />);
    expect(screen.getByTestId('bbox-percentage')).toHaveClass('low');
    expect(screen.getByTestId('bbox-roll_number')).toHaveClass('active');
  });

  it('selects a field when its region is clicked', async () => {
    const onSelect = vi.fn();
    render(<DocumentViewer src="/x.png" fields={FIELDS} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('bbox-percentage'));
    expect(onSelect).toHaveBeenCalledWith('percentage');
  });

  it('shows a placeholder without a preview', () => {
    render(<DocumentViewer fields={FIELDS} onSelect={() => undefined} />);
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  });
});

describe('FieldList review and correction', () => {
  const setup = (editable = true) => {
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(<FieldList fields={FIELDS} editable={editable} onSelect={onSelect} onCorrect={onCorrect} onConfirm={onConfirm} />);
    return { onCorrect, onConfirm, onSelect };
  };

  it('flags low-confidence and missing fields', () => {
    setup();
    expect(screen.getByTestId('field-percentage')).toHaveClass('low');
    expect(within(screen.getByTestId('field-board')).getByText('Not read — needs entry')).toBeInTheDocument();
    expect(within(screen.getByTestId('field-percentage')).getByText('62%')).toBeInTheDocument();
  });

  it('requires a reason before a correction can be saved', async () => {
    const { onCorrect } = setup();
    const row = screen.getByTestId('field-percentage');
    await userEvent.click(within(row).getByRole('button', { name: 'Correct' }));
    const save = within(row).getByRole('button', { name: 'Save correction' });
    await userEvent.clear(within(row).getByLabelText('Corrected Percentage'));
    await userEvent.type(within(row).getByLabelText('Corrected Percentage'), '88.40');
    expect(save).toBeDisabled();
    await userEvent.type(within(row).getByLabelText('Reason for correction'), 'Misread digit');
    await userEvent.click(save);
    expect(onCorrect).toHaveBeenCalledWith('percentage', '88.40', 'Misread digit');
  });

  it('offers confirm only for a low-confidence value that was read', async () => {
    const { onConfirm } = setup();
    await userEvent.click(within(screen.getByTestId('field-percentage')).getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('percentage');
    expect(within(screen.getByTestId('field-board')).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(screen.getByTestId('field-roll_number')).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('is read-only for students', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
  });

  it('shows a server error inline', async () => {
    const onCorrect = vi.fn().mockRejectedValue(new Error('This document is not assigned to you'));
    render(<FieldList fields={FIELDS} editable onSelect={() => undefined} onCorrect={onCorrect} onConfirm={vi.fn()} />);
    const row = screen.getByTestId('field-roll_number');
    await userEvent.click(within(row).getByRole('button', { name: 'Correct' }));
    await userEvent.type(within(row).getByLabelText('Reason for correction'), 'Typo fix');
    await userEvent.click(within(row).getByRole('button', { name: 'Save correction' }));
    expect(await within(row).findByText('This document is not assigned to you')).toBeInTheDocument();
  });
});

const FACTS: Record<string, FactDefinition> = {
  'marksheet.percentage': { label: 'Aggregate percentage', type: 'number', description: '' },
  'applicant.category': { label: 'Applicant category', type: 'enum', options: ['GEN', 'SC', 'ST'], description: '' },
  'marksheet.consistent': { label: 'Marksheet internally consistent', type: 'boolean', description: '' },
};

function Harness({ initial, onChange }: { initial: RuleNode; onChange: (n: RuleNode) => void }) {
  const [rule, setRule] = useState(initial);
  return <RuleBuilder value={rule} facts={FACTS} onChange={(n) => { setRule(n); onChange(n); }} />;
}

describe('RuleBuilder (no-code)', () => {
  const initial: RuleNode = { type: 'group', op: 'AND', children: [{ type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 60 }] };

  it('edits a threshold and switches AND to OR', async () => {
    const onChange = vi.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '75' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, children: [{ type: 'condition', fact: 'marksheet.percentage', operator: 'gte', value: 75 }] });
    await userEvent.selectOptions(screen.getByLabelText('Group logic'), 'OR');
    expect(onChange.mock.lastCall![0].op).toBe('OR');
  });

  it('adds a nested group and conditions', async () => {
    const onChange = vi.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('button', { name: '+ Group' })[0]);
    expect(screen.getAllByTestId('rule-group')).toHaveLength(2);
    const nested = onChange.mock.lastCall![0].children[1];
    expect(nested).toMatchObject({ type: 'group', op: 'OR', children: [{ type: 'condition', fact: 'marksheet.percentage' }] });
    await userEvent.click(screen.getAllByRole('button', { name: '+ Condition' }).at(-1)!); // outer group's button
    expect(onChange.mock.lastCall![0].children).toHaveLength(3);
  });

  it('adapts operators and values to the fact type', async () => {
    const onChange = vi.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Fact'), 'marksheet.consistent');
    expect(onChange.mock.lastCall![0].children[0]).toEqual({ type: 'condition', fact: 'marksheet.consistent', operator: 'is_true', value: undefined });
    expect(screen.getByText('No value needed')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Fact'), 'applicant.category');
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'in');
    await userEvent.click(screen.getByLabelText('SC'));
    expect(onChange.mock.lastCall![0].children[0]).toMatchObject({ operator: 'in', value: ['GEN', 'SC'] });
  });

  it('removes a condition but never the last one', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ ...initial, children: [...initial.children, { type: 'condition', fact: 'marksheet.consistent', operator: 'is_true' }] }} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[0]);
    expect(onChange.mock.lastCall![0].children).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Remove condition' })).toBeNull();
  });

  it('defaults values by operator', () => {
    expect(defaultValue(FACTS['marksheet.percentage'], 'between')).toEqual([0, 100]);
    expect(defaultValue(FACTS['applicant.category'], 'not_in')).toEqual(['GEN']);
    expect(defaultValue(FACTS['marksheet.consistent'], 'is_false')).toBeUndefined();
  });
});

describe('explanations and status', () => {
  it('renders every condition with its outcome and reason', () => {
    render(
      <EvaluationTree
        node={{
          type: 'group', op: 'AND', label: 'All of', outcome: 'fail', reason: 'All 2 conditions required — 1 met, 1 not met, 0 undetermined',
          children: [
            { type: 'condition', label: 'Aggregate percentage is at least 60', outcome: 'pass', reason: 'Aggregate percentage is 88.2; required: is at least 60' },
            { type: 'condition', label: 'Annual family income (INR) is at most 250000', outcome: 'fail', reason: 'Annual family income (INR) is 300000; required: is at most 250000' },
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId('eval-node')).toHaveLength(3);
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getAllByText('Not met')).toHaveLength(2);
    expect(screen.getByText(/is 300000; required: is at most 250000/)).toBeInTheDocument();
  });

  it('shows stage state, attempts and errors', () => {
    render(<StageTracker stages={[{ name: 'scan', status: 'done', attempts: 1 }, { name: 'ocr', status: 'failed', attempts: 3, error: 'OCR service 503' }]} />);
    expect(screen.getByTestId('stage-ocr')).toHaveClass('failed');
    expect(screen.getByText('Failed · 3 attempts')).toBeInTheDocument();
    expect(screen.getByText('Security scan')).toBeInTheDocument();
  });

  it('colours status pills by meaning', () => {
    render(<><StatusPill status="simulated_match" /><StatusPill status="authority_match" /></>);
    expect(screen.getByText('Simulated match')).toHaveClass('tone-warning');
    expect(screen.getByText('Authority match')).toHaveClass('tone-success');
  });

  it('marks confidence below threshold', () => {
    const { container } = render(<ConfidenceMeter value={0.62} threshold={0.9} />);
    expect(container.querySelector('.meter')).toHaveClass('low');
  });
});

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends JSON with same-origin credentials and returns the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api('/x', { method: 'POST', json: { a: 1 } })).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/x');
    expect(init).toMatchObject({ credentials: 'same-origin', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  });

  it('turns error envelopes into ApiError with validation details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'bad_request', message: 'Validation failed', details: [{ path: 'value', message: 'Required' }] } }), { status: 400 })));
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'bad_request', message: 'Validation failed — value: Required' });
  });
});
