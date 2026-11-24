// Keeps the page (the jweb named "web") the size of its window, so dragging the Signal Hunter window
// bigger gives the page more room instead of leaving it cut off at its original size.
autowatch = 0;
inlets = 1;
outlets = 0;

var last = "";
var task = new Task(fit, this);
task.interval = 40;  // fast enough that a window drag never shows a stretched page; a size check is cheap
task.repeat();

function fit() {
	var w = this.patcher.wind;
	if (!w || !w.visible) return;
	var s = w.size, key = s[0] + "x" + s[1];
	if (key === last) return;
	var web = this.patcher.getnamed("web");
	if (!web) return;
	last = key;
	web.setboxattr("presentation_rect", 0, 0, s[0], s[1]);
	web.setboxattr("patching_rect", 0, 0, s[0], s[1]);
}

function bang() { last = ""; fit(); }
