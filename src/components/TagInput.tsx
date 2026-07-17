import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface TagInputProps {
  autoFocus?: boolean;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}

export function TagInput({
  autoFocus = false,
  label,
  values,
  onChange,
  placeholder = "Введите и нажмите Enter",
  suggestions = [],
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const normalizedValues = new Set(values.map((value) => value.toLocaleLowerCase("ru")));
  const visibleSuggestions = suggestions
    .filter((suggestion) => suggestion.toLocaleLowerCase("ru").includes(draft.toLocaleLowerCase("ru")))
    .filter((suggestion) => !normalizedValues.has(suggestion.toLocaleLowerCase("ru")))
    .slice(0, 6);

  const add = (raw: string) => {
    const typedValue = raw.trim().replace(/^#/, "");
    const value = suggestions.find((suggestion) => suggestion.toLocaleLowerCase("ru") === typedValue.toLocaleLowerCase("ru")) ?? typedValue;
    setSuggestionsOpen(false);
    if (!value || normalizedValues.has(value.toLocaleLowerCase("ru"))) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    return () => input?.blur();
  }, []);

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
            {value}
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
          aria-expanded={suggestionsOpen && visibleSuggestions.length > 0}
          aria-haspopup="listbox"
          autoFocus={autoFocus}
          id={id}
          list={suggestionsOpen && visibleSuggestions.length ? `${id}-suggestions` : undefined}
          onBlur={() => {
            setSuggestionsOpen(false);
            if (draft) add(draft);
          }}
          onChange={(event) => {
            const nextDraft = event.currentTarget.value;
            const normalizedDraft = nextDraft.trim().replace(/^#/, "").toLocaleLowerCase("ru");
            const exactSuggestion = suggestions.find((suggestion) => suggestion.toLocaleLowerCase("ru") === normalizedDraft);
            if (exactSuggestion) {
              add(exactSuggestion);
            } else {
              setDraft(nextDraft);
              setSuggestionsOpen(true);
            }
          }}
          onFocus={() => setSuggestionsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={values.length ? "Добавить…" : placeholder}
          ref={inputRef}
          role="combobox"
          value={draft}
        />
        <datalist id={`${id}-suggestions`}>
          {visibleSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </div>
    </div>
  );
}
