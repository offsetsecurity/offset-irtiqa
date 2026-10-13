; Inno Setup script for the Windows installer.
;
; Build the payload first, then compile this against it:
;
;   pwsh deploy\windows\build.ps1 -SkipZip
;   ISCC.exe deploy\windows\offset.iss
;
; The payload and the installer therefore cannot drift: there is one build, and
; this only wraps it.
;
; UNSIGNED. Windows will show "Windows protected your PC" and the person
; installing has to choose More info -> Run anyway. That is expected until a
; code signing certificate exists; see docs/dev/roadmap.md. To sign later, add
;   SignTool=offset
; below and register the tool in the IDE or on the ISCC command line. No other
; change is needed — deliberately, so signing is a switch rather than a rewrite.

; One product per repository, so there is nothing to choose. Product stays
; a definition because the release workflow passes /DProduct.
#ifndef Product
  #define Product "ascend"
#endif

#define Display "Offset Irtiqa"
#define Framework "SAMA Cyber Security Framework"

#define Folder StringChange(Display, " ", "")
; A release passes its own: ISCC /DAppVersion=0.2.0
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define Payload "..\..\dist\windows\" + Folder

[Setup]
AppId={{8E5C0A44-6F2B-4C39-9E8A-OFFSET{#Folder}}
AppName={#Display}
AppVersion={#AppVersion}
; Shown in Add or remove programs. The shortcut keeps the short name.
AppVerName={#Display} {#AppVersion}
AppPublisher=Offset Security
AppPublisherURL=https://offsetsecurity.example
DefaultDirName={autopf}\Offset Security\{#Display}
DefaultGroupName=Offset Security
DisableProgramGroupPage=yes
; Inno 6 hides the welcome page by default. Ours says what this puts on
; the machine - its own Node, nothing added to Windows - which is the
; question an administrator has before they let it run, so it is shown.
DisableWelcomePage=no
; Task choices are otherwise restored from the previous install, so a
; default changed here would never reach anyone upgrading.
UsePreviousTasks=no
OutputDir=..\..\dist\windows
OutputBaseFilename={#Folder}-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-machine, because the data lives under ProgramData and is shared by
; everyone who uses this computer.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#Display}
LicenseFile={#Payload}\LICENSE.txt
; The product mark, in place of Inno's stock icon on the setup file and the
; generic .cmd icon Windows would otherwise draw on the shortcuts. Built from
; apps/web/src/assets/brand/mark.svg by deploy/windows/make-icon.ps1, and
; committed, so an ordinary build needs nothing installed to draw it.
SetupIconFile=offset.ico
UninstallDisplayIcon={app}\offset.ico
; Inno writes a full transcript of the install to {log}. Without this, a
; failed install leaves nothing to look at but the message on screen, which
; the person has usually already clicked past by the time they ask for help.
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#Payload}\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Payload}\app\*";    DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Payload}\README.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "{#Payload}\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Payload}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "{#Payload}\service\*"; DestDir: "{app}\service"; Flags: ignoreversion
Source: "{#Payload}\Reset administrator password.cmd"; DestDir: "{app}"; Flags: ignoreversion
; Installed, not only compiled in: the shortcuts and Add or remove programs
; point at this file on disk.
Source: "offset.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Data lives outside Program Files. It is NOT opened to ordinary users: it
; holds the encryption keys and the database. The service script grants the
; account the service runs as, and closes the folder to everyone else.
Name: "{commonappdata}\Offset Security\{#Display}"
Name: "{commonappdata}\Offset Security\{#Display}\data"
Name: "{commonappdata}\Offset Security\{#Display}\backups"
Name: "{commonappdata}\Offset Security\{#Display}\evidence"
Name: "{commonappdata}\Offset Security\{#Display}\logs"

[Icons]
; What everything points at: it opens the product in a browser, and starts it
; first if it is not already running. The shortcut used to run the launcher,
; so double-clicking it opened a console window and nothing else - and closing
; the window nobody understood stopped the product.
Name: "{group}\{#Display}"; Filename: "wscript.exe"; \
  Parameters: """{app}\app\open.vbs"""; WorkingDir: "{app}"; \
  Comment: "Open {#Display} ({#Framework})"; \
  IconFilename: "{app}\offset.ico"
; For when something is wrong and the window is the point: this one shows the
; application's own output as it starts.
Name: "{group}\{#Display} in a window"; Filename: "{app}\app\launch-installed.cmd"; \
  WorkingDir: "{app}"; Comment: "Start {#Display} with its console window"; \
  IconFilename: "{app}\offset.ico"
; The address itself, for when it is already running. This was hardcoded to
; port 8080, which was wrong for every install that chose anything else.
Name: "{group}\{#Display} in your browser"; Filename: "{code:AppUrl}"; \
  IconFilename: "{app}\offset.ico"
Name: "{group}\{#Display} documents"; Filename: "{app}\docs"
Name: "{group}\{#Display} data folder"; Filename: "{commonappdata}\Offset Security\{#Display}"
Name: "{group}\{#Display} logs"; Filename: "{commonappdata}\Offset Security\{#Display}\logs"; \
  Comment: "Open the folder to send to support"
; Run as administrator: it changes the database of this copy.
Name: "{group}\Reset {#Display} administrator password"; Filename: "{app}\Reset administrator password.cmd"; \
  WorkingDir: "{app}"; Comment: "Run as administrator, when no administrator can sign in"; \
  IconFilename: "{app}\offset.ico"
Name: "{group}\Uninstall {#Display}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#Display}"; Filename: "wscript.exe"; \
  Parameters: """{app}\app\open.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon; \
  IconFilename: "{app}\offset.ico"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
; Checked by default. Nothing is downloaded until an administrator asks in
; Settings, and every update is checked against Offset Security's signature.
Name: "updates"; Description: "Let administrators install updates from Settings"; \
  GroupDescription: "Updates:"

[Run]
; The service installer starts it too, so only offer the manual start when
; the service was not chosen. Two copies fighting over one database file is
; not a first-run experience worth having.
; Always, not a tick box. Without the service the product runs only while
; somebody keeps a window open, and the first person to close that window
; stops it for everyone. That is not a preference, it is a defect.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\install-service.ps1"""; \
  StatusMsg: "Setting {#Display} to start with Windows..."; \
  Flags: runhidden waituntilterminated
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\install-updater.ps1"""; \
  StatusMsg: "Setting up updates..."; \
  Flags: runhidden waituntilterminated; Tasks: updates
; Ends where the person wants to be: looking at it in a browser.
Filename: "wscript.exe"; Parameters: """{app}\app\open.vbs"""; \
  WorkingDir: "{app}"; Description: "Open {#Display} now"; \
  Flags: postinstall nowait skipifsilent

[UninstallRun]
; The updater first, so it cannot start an install while files are removed.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\uninstall-updater.ps1"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "RemoveOffsetUpdater"
; Take the background service away before the files it points at go, and
; ignore any failure: it may never have been installed.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service\uninstall-service.ps1"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "RemoveOffsetService"

[UninstallDelete]
; The application only. Data, backups and .env are deliberately left behind —
; an uninstaller that silently deletes someone's compliance records and audit
; trail would be indefensible. The final message says where they are.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\service"
Type: files; Name: "{app}\node.exe"
Type: files; Name: "{app}\install.json"

[Messages]
; Said before anything is installed, because "what is this about to do to my
; machine" is the question an administrator has at that moment, and the answer
; is unusually good: nothing is added to Windows itself.
WelcomeLabel2=This installs {#Display}, for {#Framework}.%n%nIt brings its own copy of Node.js, inside its own folder. Nothing is added to Windows, no other software is needed, and nothing you already have is changed or upgraded.%n%nIt answers on one port on this machine, which you choose in a moment. Your data is kept outside Program Files, in ProgramData, so it survives an uninstall.
FinishedLabel=Setup has installed {#Display}.%n%nYour data is kept in:%n{commonappdata}\Offset Security\{#Display}%n%nBack up the "data" folder to back up everything.%nIf anything goes wrong, the "logs" folder beside it is what support asks for.

[Code]
var
  PortPage: TInputQueryWizardPage;
  { Set when the install starts and when it finishes, so a failure in between
    can be told apart from pressing Cancel. }
  InstallStarted: Boolean;
  InstallFinished: Boolean;

function DataFolder(): String;
begin
  Result := ExpandConstant('{commonappdata}\Offset Security\{#Display}');
end;

{ An upgrade already has a port, chosen at first install and possibly changed
  by hand since. Asking again would invite someone to answer with a number
  that does not match the one their colleagues have bookmarked. }
function AlreadyConfigured(): Boolean;
begin
  Result := FileExists(DataFolder() + '\.env');
end;

{ The first port from Start upward that nothing is listening on.

  Inno has no sockets, so Windows is asked through PowerShell and answers into
  a file. A machine with nothing free below 65535 is not a machine this will
  run on, so the loop cannot spin forever in practice. }
function FirstFreePort(Start: Integer): Integer;
var
  ResultCode: Integer;
  Answer: AnsiString;
  Path: String;
begin
  Result := Start;
  Path := ExpandConstant('{tmp}\offset-port.txt');
  DeleteFile(Path);
  if Exec('powershell.exe',
          '-NoProfile -ExecutionPolicy Bypass -Command "' +
          '$p = ' + IntToStr(Start) + '; ' +
          'while ($p -lt 65535 -and (Get-NetTCPConnection -LocalPort $p -State Listen ' +
          '-ErrorAction SilentlyContinue)) { $p++ }; ' +
          'Set-Content -Path \"' + Path + '\" -Value $p -Encoding ascii"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    if LoadStringFromFile(Path, Answer) then
      Result := StrToIntDef(Trim(String(Answer)), Start);
end;

function PortIsFree(Port: Integer): Boolean;
begin
  Result := FirstFreePort(Port) = Port;
end;

{ The port the first run should write into .env.

  From the page when somebody answered it, from /PORT= for an unattended
  install, and 8080 when neither said anything. }
function ChosenPort(): String;
begin
  if (PortPage <> nil) and (Trim(PortPage.Values[0]) <> '') then
    Result := Trim(PortPage.Values[0])
  else
    Result := ExpandConstant('{param:port|8080}');
end;

{ The port this install will actually answer on.

  From .env when there is one, because an upgrade keeps the port it was given
  and somebody has that address bookmarked. From the page, or /PORT=, on a
  first install. The browser shortcut is built from this: it used to be
  hardcoded to 8080, which was wrong for every install that chose anything
  else. }
function InstalledPort(): String;
var
  Lines: TArrayOfString;
  I: Integer;
  EnvPath: String;
begin
  Result := '';
  EnvPath := ExpandConstant('{commonappdata}\Offset Security\{#Display}\.env');
  if LoadStringsFromFile(EnvPath, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
      { The last PORT line wins, because that is the one dotenv gives the
        application when a file has two of them. }
      if Pos('PORT=', Lines[I]) = 1 then
        Result := Trim(Copy(Lines[I], 6, Length(Lines[I])));
  if Result = '' then
    Result := ChosenPort();
end;

function AppUrl(Param: String): String;
begin
  Result := 'http://localhost:' + InstalledPort();
end;

procedure InitializeWizard();
begin
  PortPage := CreateInputQueryPage(wpSelectTasks,
    'Network port',
    'Which port should {#Display} answer on?',
    '{#Display} answers on one port on this machine. 8080 is the usual one, ' +
    'and the box below is already filled in with the first port nothing else ' +
    'is using - so you can accept it, or type any other port you prefer. ' +
    'Whatever you choose is the address you will use to open it.');
  PortPage.Add('Port:', False);
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Suggested: Integer;
begin
  { Filled here rather than in InitializeWizard: asking Windows what is free
    takes a moment, and doing it while the first page is drawing makes the
    installer look stuck before it has said anything.

    The page is shown on an upgrade too. Skipping it meant a reinstall never
    mentioned the port and quietly kept a number chosen long ago on a day when
    8080 happened to be busy. Leaving the box alone keeps that port. }
  if (CurPageID = PortPage.ID) and (Trim(PortPage.Values[0]) = '') then
  begin
    if AlreadyConfigured() then
    begin
      PortPage.Values[0] := InstalledPort();
      PortPage.SubCaptionLabel.Caption :=
        'Your data from an earlier {#Display} install was found here, and it ' +
        'used port ' + InstalledPort() + '. Leave the box as it is to keep that ' +
        'address working for everyone who has it bookmarked, or type another ' +
        'port to move it.';
    end
    else
    begin
      Suggested := FirstFreePort(8080);
      PortPage.Values[0] := IntToStr(Suggested);
      if Suggested <> 8080 then
        PortPage.SubCaptionLabel.Caption :=
          '8080 is the usual port, and something else on this machine is ' +
          'already using it - so ' + IntToStr(Suggested) + ' is suggested ' +
          'instead. Accept it, or type any other port you prefer. Whatever ' +
          'you choose is the address you will use to open it.';
    end;
  end;

  { The finish page, which said where the data lives but never where the
    product is. That address was the one thing the person needed next, and
    they were reading it out of a console window instead. }
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption +
      Chr(13) + Chr(10) + Chr(13) + Chr(10) + 'It answers on ' + AppUrl('') +
      '  -  the shortcut opens it for you.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
  Free: Integer;
begin
  Result := True;
  if CurPageID <> PortPage.ID then exit;

  Port := StrToIntDef(Trim(PortPage.Values[0]), 0);
  if (Port < 1024) or (Port > 65535) then
  begin
    SuppressibleMsgBox('Enter a port between 1024 and 65535.' + #13#10#13#10 +
                       'Ports below 1024 are reserved for Windows itself.',
                       mbError, MB_OK, IDOK);
    Result := False;
    exit;
  end;

  if not PortIsFree(Port) then
  begin
    Free := FirstFreePort(Port);
    Result := SuppressibleMsgBox('Something is already listening on port ' +
                       IntToStr(Port) + '.' + #13#10#13#10 +
                       '{#Display} would install and then fail to start. ' +
                       'Port ' + IntToStr(Free) + ' is free.' + #13#10#13#10 +
                       'Use ' + IntToStr(Port) + ' anyway?',
                       mbConfirmation, MB_YESNO, IDNO) = IDYES;
    if not Result then
      PortPage.Values[0] := IntToStr(Free);
  end;
end;

{ Moves an existing install to a different port.

  Only when somebody typed a different number on the page: .env holds the
  secrets as well, so it is rewritten when there is a reason and left alone
  when there is not. }
procedure SetEnvPort(Port: String);
var
  Lines: TArrayOfString;
  I: Integer;
  Path: String;
begin
  Path := DataFolder() + '\.env';
  if not LoadStringsFromFile(Path, Lines) then exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    if Pos('PORT=', Lines[I]) = 1 then
      Lines[I] := 'PORT=' + Port;
    if Pos('PUBLIC_URL=', Lines[I]) = 1 then
      Lines[I] := 'PUBLIC_URL=http://localhost:' + Port;
  end;
  SaveStringsToFile(Path, Lines, False);
end;

{ The README ships with the usual port written into it, because it is written
  when the package is built and the port is chosen when it is installed. It
  said 8080 to somebody whose install answers on 8089. }
procedure SetReadmePort(Port: String);
var
  Lines: TArrayOfString;
  I: Integer;
  Path: String;
  Changed: Boolean;
begin
  Path := ExpandConstant('{app}\README.txt');
  if not LoadStringsFromFile(Path, Lines) then exit;
  Changed := False;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos('http://localhost:8080', Lines[I]) > 0 then
    begin
      StringChangeEx(Lines[I], 'http://localhost:8080',
                     'http://localhost:' + Port, True);
      Changed := True;
    end;
  if Changed then
    SaveStringsToFile(Path, Lines, False);
end;

{ Writes the chosen port into the template the launcher fills in on first run.

  The template, not .env: .env does not exist yet, and the launcher creates it
  with fresh secrets the first time it starts. On an upgrade .env is already
  there and is left exactly as it is. }
procedure SetTemplatePort(Port: String);
var
  Lines: TArrayOfString;
  I: Integer;
  Path: String;
begin
  Path := ExpandConstant('{app}\app\env.template');
  if not LoadStringsFromFile(Path, Lines) then exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    if Pos('PORT=', Lines[I]) = 1 then
      Lines[I] := 'PORT=' + Port;
    if Pos('PUBLIC_URL=', Lines[I]) = 1 then
      Lines[I] := 'PUBLIC_URL=http://localhost:' + Port;
  end;
  SaveStringsToFile(Path, Lines, False);
end;

{ Keep the installer's own transcript beside the application's logs.
  Inno writes it to the temporary folder, which Windows eventually clears,
  and a person asked for "the install log" will not go looking there. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  LogFolder: String;
begin
  if CurStep = ssInstall then
    InstallStarted := True;
  if CurStep = ssPostInstall then
  begin
    InstallFinished := True;
    if AlreadyConfigured() then
    begin
      { Asked, and answered with something else: move it. }
      if ChosenPort() <> InstalledPort() then
        SetEnvPort(ChosenPort());
    end
    else
      SetTemplatePort(ChosenPort());
    SetReadmePort(InstalledPort());
    { Marks this as an installed copy, which the launcher reads to offer
      one-click updates. The portable zip has no such file. }
    { The port is here too, for the Start menu shortcut: ordinary users cannot
      read .env, which sits in the data folder with the keys. }
    SaveStringToFile(ExpandConstant('{app}\install.json'), '{"kind":"windows","port":' + InstalledPort() + '}', False);
    LogFolder := ExpandConstant('{commonappdata}\Offset Security\{#Display}\logs');
    if ForceDirectories(LogFolder) then
      CopyFile(ExpandConstant('{log}'), LogFolder + '\install.log', False);
  end;
end;

{ Stops a running copy, so its files can be replaced.

  This used to be a warning: "close its window, or stop the background
  service, before continuing". Then it carried on and failed on node.exe,
  which the running copy holds open - and on a silent install the retry
  prompt defaults to Abort, so the install rolled back with exit code 5 and
  the customer stayed on the old version.

  The service runs as LOCAL SERVICE, so this needs the elevation the installer
  already has, and it matches what the in-app updater does. }
procedure StopRunningCopy();
var
  ResultCode: Integer;
begin
  Exec('powershell.exe',
       '-NoProfile -ExecutionPolicy Bypass -Command "' +
       '$ErrorActionPreference = ''SilentlyContinue''; ' +
       'Stop-ScheduledTask -TaskName ''{#Display}''; ' +
       'Stop-ScheduledTask -TaskName ''{#Display} updater''; ' +
       '$dir = ''' + ExpandConstant('{app}') + '''; ' +
       'Get-Process -Name node -ErrorAction SilentlyContinue | ' +
       'Where-Object { $_.Path -and $_.Path.StartsWith($dir) } | ' +
       'Stop-Process -Force; ' +
       'Start-Sleep -Seconds 2"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  StopRunningCopy();
end;

{ Kept for the record: what this used to do instead.

  Two mistakes were in the first version of this, both found by running a
  silent install.

  It used MsgBox, which a silent install cannot answer, so /VERYSILENT
  /SUPPRESSMSGBOXES took the default of No and the installer cancelled itself
  with exit code 5. Unattended installation is how an IT department deploys
  this, so that was the worst possible thing to get wrong.
  SuppressibleMsgBox answers itself with Yes when nobody is there.

  It also matched any node.exe at all, so it fired on the developer's own
  server, on an unrelated Electron app, on anything. Matching our launcher by
  its command line costs a second of PowerShell and asks only when it is
  actually our process. }
function OffsetIsRunning(): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;
  if Exec('powershell.exe',
          '-NoProfile -ExecutionPolicy Bypass -Command "' +
          'if (Get-CimInstance Win32_Process -Filter ""Name=''node.exe''"" | ' +
          'Where-Object { $_.CommandLine -like ''*start.js*'' }) { exit 0 } else { exit 1 }"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Result := ResultCode = 0;
end;

{ A failed install keeps its transcript too, under a name that says so.

  Inno's own log goes to the temporary folder and is lost on the next clean-up,
  and the failure message on screen is usually gone before anyone asks for it.
  Only an install that started and did not finish is reported: pressing Cancel
  on the first page is not a failure. }
procedure DeinitializeSetup();
var
  LogFolder, Target: String;
begin
  if InstallStarted and not InstallFinished then
  begin
    LogFolder := ExpandConstant('{commonappdata}\Offset Security\{#Display}\logs');
    Target := LogFolder + '\install-failed-' + GetDateTimeString('yyyymmdd-hhnnss', #0, #0) + '.log';
    if ForceDirectories(LogFolder) and FileCopy(ExpandConstant('{log}'), Target, False) then
    begin
      if not WizardSilent() then
        MsgBox('{#Display} did not finish installing.' + #13#10 + #13#10 +
               'What happened is written to:' + #13#10 + Target + #13#10 + #13#10 +
               'Please send that file to support.', mbError, MB_OK);
    end;
  end;
end;

function InitializeSetup(): Boolean;
begin
  { Nothing to ask. A running copy is stopped in PrepareToInstall, after the
    person has answered the wizard and before any file is replaced. }
  Result := True;
end;
