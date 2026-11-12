'use client';
/** Shown when the server no longer lets this user read the patient they had open (it answers 404). */
import React from 'react';
import { useHalqa } from '@/context/HalqaStore';
import { tabForView } from '@/components/design/Shell';
import { Button, Empty } from '@/components/design/primitives';

export function NotOnList() {
  const { s, leaveNotOnList } = useHalqa();
  return (
    <div className="space-y-6">
      <Empty
        title="This patient is not on your list"
        text="They may have been handed over to someone else."
        action={<Button kind="secondary" onClick={leaveNotOnList}>Back to {tabForView(s.view)}</Button>}
      />
    </div>
  );
}
