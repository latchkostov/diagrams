import { useId, useState, type Ref } from "react";
import { MIN_PASSWORD_LENGTH } from "../passwordLink";
import { passwordStrength } from "../passwordStrength";

/**
 * A new password: the field, its strength hint underneath and Show. One pattern wherever a diagram is encrypted
 * with a password (Copy link with password… and Interactive HTML's Require a password): at least
 * MIN_PASSWORD_LENGTH characters, the hint under the field, and Show rather than a second field to confirm it.
 * Test ids: `<testId>-input`, `-strength` and `-show`.
 */
export function PasswordField({
  value,
  onChange,
  testId,
  firstFocus,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  /** Takes the dialog's first focus (Dialog's data-autofocus). */
  firstFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  const hintId = useId();
  return (
    <>
      <label className="ix-password-field">
        <span className="ix-form-label">Password</span>
        <span className="ix-field-row">
          <input
            ref={inputRef}
            className="ix-input"
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby={hintId}
            data-autofocus={firstFocus || undefined}
            data-testid={`${testId}-input`}
          />
        </span>
      </label>
      <div className="ix-meta-row">
        <span
          id={hintId}
          className={`ix-strength is-${value ? strength.level : "empty"}`}
          data-level={value ? strength.level : "empty"}
          data-testid={`${testId}-strength`}
        >
          {value ? strength.hint : `At least ${MIN_PASSWORD_LENGTH} characters. Several random words work well.`}
        </span>
        <span className="ix-grow" />
        <label className="ix-check">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
            data-testid={`${testId}-show`}
          />
          Show
        </label>
      </div>
    </>
  );
}
