import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface DraftConfirmDialogProps {
  open: boolean;
  isNew: boolean;
  subject?: string;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}

export const DraftConfirmDialog: React.FC<DraftConfirmDialogProps> = ({ open, isNew, subject = 'offer', onSave, onDiscard, onContinue }) => (
  <ConfirmDialog
    open={open}
    tone="warning"
    title="Unsaved changes"
    description={isNew ? `This new ${subject} has unsaved changes. Choose whether to save it, discard it, or continue editing.` : `This ${subject} has unsaved changes. Choose whether to save them, discard them, or continue editing.`}
    confirmLabel={isNew ? 'Discard' : 'Discard changes'}
    cancelLabel="Continue editing"
    secondaryLabel={isNew ? 'Save' : 'Save changes'}
    onCancel={onContinue}
    onConfirm={onDiscard}
    onSecondary={onSave}
  />
);
