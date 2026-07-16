import { useId, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface TagInputProps {
  autoFocus?: boolean;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  prefix?: string;
  suggestions?: string[];
}

export function TagInput({
  autoFocus = false,
  label,
  values,
  onChange,
  placeholder = "Введите и нажмите Enter",
  prefix = "",
  suggestions = [],
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const normalizedValues = new Set(values.map((value) => value.toLocaleLowerCase("ru")));
  const visibleSuggestions = suggestions
    .filter((suggestion) => suggestion.toLocaleLowerCase("ru").includes(draft.toLocaleLowerCase("ru")))
    .filter((suggestion) => !normalizedValues.has(suggestion.toLocaleLowerCase("ru")))
    .slice(0, 6);

  const add = (raw: string) => {
    const typedValue = raw.trim().replace(/^#/, "");
    const value = suggestions.find((suggestion) => suggestion.toLocaleLowerCase("ru") === typedValue.toLocaleLowerCase("ru")) ?? typedValue;
    if (!value || normalizedValues.has(value.toLocaleLowerCase("ru"))) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="tag-input field-group">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="tag-input__control">
        {values.map((value) => (
          <span className="tag-chip" key={value}>
            {prefix}{value}
            <button
              aria-label={`Удалить ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              type="button"
            >
              <Icon name="close" size={13} />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          id={id}
          list={`${id}-suggestions`}
          onBlur={() => draft && add(draft)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={values.length ? "Добавить…" : placeholder}
          value={draft}
        />
        <datalist id={`${id}-suggestions`}>
          {visibleSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </div>
    </div>
  );
}
