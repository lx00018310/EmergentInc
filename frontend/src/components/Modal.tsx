import { t as tr, useLanguage } from '../i18n';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
  overlayClassName?: string;
  keepMounted?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  onClose,
  children,
  footer,
  contentClassName = '',
  overlayClassName = '',
  keepMounted = false,
}) => {
  useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen && !keepMounted) return null;

  const content = (
    <div
      className={`modal-overlay ${overlayClassName}`.trim()}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={isOpen ? undefined : { display: 'none' }}
    >
      <div
        className={`modal-content ${contentClassName}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-close" onClick={onClose} aria-label={tr("关闭")}>
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );

  if (typeof document === 'undefined' || !mounted) {
    return content;
  }

  return createPortal(content, document.body);
};
