# cop-capability-sunburst

# Installation

Power BI Tools (SDK):
https://github.com/Microsoft/PowerBI-visuals-tools

HOW TO DEBUG
1. `cmd>"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222`
2. VSCode must have 'Debugger for Chrome' extension installed (Ctrl+X, Ctrl+Y)
3. VSCode > Terminal > `pbiviz start`
4. In Chrome opened in step 1, sign in to Power BI (PBI) Online and open the report with an instance of the Developer Visual (development mode should be enabled in PBI Online).
5. VSCode > Debug
6. Finally, breakpoints don't work, so fallback to logging like described here:
https://community.powerbi.com/t5/Developer/How-to-Debug-while-developing-Custom-Visuals/td-p/187053


