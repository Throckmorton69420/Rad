import React, { forwardRef } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  className = '',
  ...props
}, ref) => {
  const baseStyles = 'font-semibold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-secondary)] transition-all duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed interactive-glow-border';

  const variantStyles = {
    primary: 'text-white focus-visible:ring-[var(--accent-purple)] bg-[var(--glass-background-button)] hover:bg-[var(--glass-background-button-hover)] border-none backdrop-blur-lg',
    secondary: 'text-[var(--text-primary)] bg-[var(--glass-background-panel)] hover:bg-white/20 focus-visible:ring-[var(--text-secondary)] border-none backdrop-blur-lg',
    danger: 'bg-[var(--accent-red)] text-white hover:bg-red-500 focus-visible:ring-[var(--accent-red)]',
    ghost: 'bg-transparent text-[var(--accent-purple)] hover:bg-[var(--accent-purple)]/20 focus-visible:ring-[var(--accent-purple)]',
  };

  const sizeStyles = {
    sm: 'px-4 py-2 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      ref={ref}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {leftIcon && <span className="mr-2">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="ml-2">{rightIcon}</span>}
    </button>
  );
});

Button.displayName = 'Button';