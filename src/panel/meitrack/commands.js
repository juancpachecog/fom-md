/** Only the command list, never a full SMS containing the device identity. */
export function parseT399CommandList(value) {
    if (typeof value !== "string" || value.length > 2048)
        return null;
    if (value.trim() === "")
        return [];
    const commands = value.split(",").map(command => command.trim().toUpperCase());
    if (commands.length > 256 || commands.some(command => !/^[A-F0-9]{3}$/.test(command)))
        return null;
    return [...new Set(commands)];
}
/** Fixed read-only allowlist. Announced support never authorizes writes. */
export function t399ReadOnlyQuery(password, command, announced = []) {
    if (typeof password !== "string" || !/^[0-9]{4}$/.test(password)
        || !["E91", "E04", "DB4", "DA6"].includes(command)
        || (["DB4", "DA6"].includes(command) && !announced.includes(command)))
        return null;
    return `${password},${command}`;
}
