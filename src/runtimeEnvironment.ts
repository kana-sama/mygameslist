const RUNTIME_ENVIRONMENT_ATTRIBUTE = "data-runtime-environment";

export function markRuntimeEnvironment(element: HTMLElement, isDevelopment: boolean): void {
  if (isDevelopment) {
    element.setAttribute(RUNTIME_ENVIRONMENT_ATTRIBUTE, "development");
    return;
  }

  element.removeAttribute(RUNTIME_ENVIRONMENT_ATTRIBUTE);
}
