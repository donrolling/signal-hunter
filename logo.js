// Signal Hunter logo for the Live device panel (jsui). Same drawing as assets/logo.svg, in a 64x64 box.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

function paint() {
	var s = (box.rect[2] - box.rect[0]) / 64;
	with (mgraphics) {
		scale(s, s);
		set_line_cap("round");
		set_line_join("round");
		set_source_rgba(0.94, 0.71, 0.30, 1);  // amber reticle
		set_line_width(3);
		ellipse(13, 13, 38, 38);
		stroke();
		move_to(32, 4); line_to(32, 11);
		move_to(32, 53); line_to(32, 60);
		move_to(4, 32); line_to(11, 32);
		move_to(53, 32); line_to(60, 32);
		stroke();
		set_source_rgba(0.91, 0.90, 0.87, 1);  // waveform
		set_line_width(2.6);
		var p = [[17, 32], [21, 32], [24, 26], [28, 40], [32, 20], [36, 36], [39, 28], [41, 32], [47, 32]];
		move_to(p[0][0], p[0][1]);
		for (var i = 1; i < p.length; i++) line_to(p[i][0], p[i][1]);
		stroke();
	}
}
