use eframe::egui;
use clap::Parser;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const BG: egui::Color32 = egui::Color32::from_rgb(10, 10, 12);
const PANEL: egui::Color32 = egui::Color32::from_rgb(19, 17, 18);
const PANEL_RAISED: egui::Color32 = egui::Color32::from_rgb(29, 25, 25);
const WINE: egui::Color32 = egui::Color32::from_rgb(39, 12, 12);
const GOLD: egui::Color32 = egui::Color32::from_rgb(205, 151, 54);
const GOLD_DIM: egui::Color32 = egui::Color32::from_rgb(130, 94, 39);
const TEXT: egui::Color32 = egui::Color32::from_rgb(235, 226, 211);
const MUTED: egui::Color32 = egui::Color32::from_rgb(151, 143, 132);
const GREEN: egui::Color32 = egui::Color32::from_rgb(91, 174, 89);

fn card_frame() -> egui::Frame {
    egui::Frame::none()
        .fill(PANEL)
        .stroke(egui::Stroke::new(1.0_f32, egui::Color32::from_rgb(58, 48, 39)))
        .rounding(egui::Rounding::same(8.0))
        .inner_margin(egui::Margin::same(14.0))
}

fn section_title(ui: &mut egui::Ui, title: &str) {
    ui.label(
        egui::RichText::new(title.to_uppercase())
            .size(12.0)
            .strong()
            .color(GOLD),
    );
    ui.add_space(8.0);
}

fn apply_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.override_text_color = Some(TEXT);
    visuals.panel_fill = BG;
    visuals.window_fill = PANEL_RAISED;
    visuals.extreme_bg_color = egui::Color32::from_rgb(8, 8, 9);
    visuals.faint_bg_color = egui::Color32::from_rgb(30, 25, 22);
    visuals.hyperlink_color = GOLD;
    visuals.selection.bg_fill = egui::Color32::from_rgb(91, 56, 23);
    visuals.selection.stroke = egui::Stroke::new(1.0_f32, GOLD);
    visuals.window_rounding = egui::Rounding::same(8.0);
    visuals.window_stroke = egui::Stroke::new(1.0_f32, GOLD_DIM);
    visuals.widgets.noninteractive.bg_fill = PANEL;
    visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0_f32, TEXT);
    visuals.widgets.noninteractive.bg_stroke =
        egui::Stroke::new(1.0_f32, egui::Color32::from_rgb(58, 48, 39));
    visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(35, 29, 25);
    visuals.widgets.inactive.weak_bg_fill = egui::Color32::TRANSPARENT;
    visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0_f32, TEXT);
    visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0_f32, GOLD_DIM);
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(74, 48, 24);
    visuals.widgets.hovered.weak_bg_fill = egui::Color32::from_rgb(49, 34, 24);
    visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0_f32, egui::Color32::WHITE);
    visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0_f32, GOLD);
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(94, 62, 27);
    visuals.widgets.active.weak_bg_fill = visuals.widgets.active.bg_fill;
    visuals.widgets.active.fg_stroke = egui::Stroke::new(1.0_f32, egui::Color32::WHITE);
    visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0_f32, GOLD);
    for widget in [
        &mut visuals.widgets.noninteractive,
        &mut visuals.widgets.inactive,
        &mut visuals.widgets.hovered,
        &mut visuals.widgets.active,
    ] {
        widget.rounding = egui::Rounding::same(5.0);
    }

    let mut style = (*ctx.style()).clone();
    style.visuals = visuals;
    style.spacing.item_spacing = egui::vec2(10.0, 8.0);
    style.spacing.button_padding = egui::vec2(12.0, 7.0);
    style.spacing.interact_size = egui::vec2(36.0, 30.0);
    style.text_styles.insert(
        egui::TextStyle::Heading,
        egui::FontId::proportional(24.0),
    );
    style.text_styles.insert(
        egui::TextStyle::Body,
        egui::FontId::proportional(15.0),
    );
    ctx.set_style(style);
}

#[derive(Parser, Debug)]
#[command(name = "rrpg", about = "Virtual Tabletop & RPG Platform")]
struct Args {
    #[arg(long, value_name = "FILE")]
    screenshot: Option<PathBuf>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
enum GameMode {
    Lobby,
    Room { name: String },
    CharacterSheet,
    CampaignManager,
    Chat,
    DiceRoller,
    Moderation,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Character {
    name: String,
    class: String,
    level: u32,
    hp: u32,
    max_hp: u32,
    strength: u32,
    dexterity: u32,
    constitution: u32,
    intelligence: u32,
    wisdom: u32,
    charisma: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ChatMessage {
    sender: String,
    text: String,
    timestamp: String,
}

struct RrpgApp {
    mode: GameMode,
    characters: Vec<Character>,
    selected_char: usize,
    chat_messages: Vec<ChatMessage>,
    chat_input: String,
    dice_sides: u32,
    dice_count: u32,
    dice_results: Vec<u32>,
    dice_total: u32,
    room_name_input: String,
    campaign_notes: String,
    muted_users: Vec<String>,
    ban_list: Vec<String>,
    search_query: String,
    lobby_tab: usize,
    moderation_input: String,
    screenshot_path: Option<PathBuf>,
    screenshot_requested: bool,
    frame_count: usize,
}

impl Default for RrpgApp {
    fn default() -> Self {
        Self {
            mode: GameMode::Lobby,
            characters: vec![Character {
                name: "Hero Alden".to_string(),
                class: "Paladin".to_string(),
                level: 5,
                hp: 45,
                max_hp: 45,
                strength: 16,
                dexterity: 10,
                constitution: 14,
                intelligence: 10,
                wisdom: 12,
                charisma: 15,
            }],
            selected_char: 0,
            chat_messages: vec![
                ChatMessage {
                    sender: "System".to_string(),
                    text: "Welcome to RRPG Virtual Tabletop! No subscription locks active.".to_string(),
                    timestamp: "12:00".to_string(),
                },
            ],
            chat_input: String::new(),
            dice_sides: 20,
            dice_count: 1,
            dice_results: vec![],
            dice_total: 0,
            room_name_input: "Main Tavern".to_string(),
            campaign_notes: "The party is resting at the Prancing Pony. Rumors of goblins in the East Woods.".to_string(),
            muted_users: vec![],
            ban_list: vec![],
            search_query: String::new(),
            lobby_tab: 0,
            moderation_input: String::new(),
            screenshot_path: None,
            screenshot_requested: false,
            frame_count: 0,
        }
    }
}

impl RrpgApp {
    fn show_lobby(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("CENTRAL DE AVENTURAS").size(11.0).strong().color(GOLD));
                ui.heading("Mesas virtuais");
                ui.label(egui::RichText::new("Encontre seu grupo. Prepare a próxima aventura.").color(MUTED));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button(egui::RichText::new("Criar mesa").strong().color(GOLD)).clicked() {
                    if self.room_name_input.trim().is_empty() {
                        self.room_name_input = "Nova aventura".to_string();
                    }
                    self.mode = GameMode::Room {
                        name: self.room_name_input.clone(),
                    };
                }
            });
        });
        ui.add_space(16.0);

        let tabs = ["Procurar mesas", "Recentes", "Minhas mesas", "Favoritas"];
        ui.horizontal(|ui| {
            for (index, tab) in tabs.iter().enumerate() {
                let selected = self.lobby_tab == index;
                if ui
                    .selectable_label(
                        selected,
                        egui::RichText::new(*tab)
                            .strong()
                            .color(if selected { GOLD } else { MUTED }),
                    )
                    .clicked()
                {
                    self.lobby_tab = index;
                }
            }
        });
        ui.add_space(10.0);

        ui.horizontal(|ui| {
            ui.add_sized(
                [310.0, 34.0],
                egui::TextEdit::singleline(&mut self.search_query)
                    .hint_text("Nome da mesa, sistema ou mestre..."),
            );
            if ui.button("Buscar").clicked() {
                self.lobby_tab = 0;
            }
            ui.add_space(10.0);
            ui.label(egui::RichText::new("FILTROS").size(11.0).strong().color(GOLD_DIM));
            ui.label(egui::RichText::new("Dados de demonstração").size(12.0).color(MUTED));
        });
        ui.add_space(14.0);

        ui.columns(2, |columns| {
            columns[0].set_width(columns[0].available_width());
            egui::ScrollArea::vertical().show(&mut columns[0], |ui| {
                let rooms = [
                    ("Contos do Alpha", "Outro sistema", "JvBR", "1 jogador", "Campanha aberta"),
                    ("A Última Vigília", "D20 / fantasia sombria", "Mestre: Arannis", "4 jogadores", "Demonstração"),
                    ("Iquera", "D20 / aventura", "Mestre: Lua", "2 jogadores", "Mesa para iniciantes"),
                    ("Mirror World", "Sistema próprio", "Mestre: Raven", "3 jogadores", "Demonstração"),
                ];
                for (index, (name, system, host, players, status)) in rooms.iter().enumerate() {
                    if (self.lobby_tab == 1 && index > 1)
                        || (self.lobby_tab == 2 && index != 0)
                        || (self.lobby_tab == 3 && index != 2 && index != 3)
                    {
                        continue;
                    }
                    if !self.search_query.is_empty()
                        && !format!("{name} {system} {host}")
                            .to_lowercase()
                            .contains(&self.search_query.to_lowercase())
                    {
                        continue;
                    }
                    card_frame().show(ui, |ui| {
                        ui.horizontal(|ui| {
                            egui::Frame::none()
                                .fill(if index == 0 {
                                    egui::Color32::from_rgb(73, 42, 30)
                                } else {
                                    egui::Color32::from_rgb(45, 37, 32)
                                })
                                .rounding(egui::Rounding::same(7.0))
                                .inner_margin(egui::Margin::same(9.0))
                                .show(ui, |ui| {
                                    ui.label(
                                            egui::RichText::new(["CA", "AV", "IQ", "MW"][index])
                                            .size(25.0)
                                            .color(GOLD),
                                    );
                                });
                            ui.vertical(|ui| {
                                ui.label(egui::RichText::new(*name).size(17.0).strong().color(TEXT));
                                ui.label(egui::RichText::new(*system).color(GOLD));
                                ui.label(
                                    egui::RichText::new(format!("{host}  •  {players}"))
                                        .size(12.0)
                                        .color(MUTED),
                                );
                            });
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if ui.button("Entrar").clicked() {
                                    self.mode = GameMode::Room {
                                        name: (*name).to_string(),
                                    };
                                }
                                ui.label(egui::RichText::new(*status).size(11.0).color(GREEN));
                            });
                        });
                    });
                    ui.add_space(7.0);
                }
            });

            columns[1].set_width(280.0);
            card_frame().show(&mut columns[1], |ui| {
                section_title(ui, "Sua mesa");
                ui.label(egui::RichText::new("Comece uma nova história").size(18.0).strong());
                ui.label(
                    egui::RichText::new("Crie uma sala local e convide seu grupo para jogar.")
                        .color(MUTED),
                );
                ui.add_space(8.0);
                ui.label(egui::RichText::new("NOME DA MESA").size(11.0).strong().color(GOLD_DIM));
                ui.text_edit_singleline(&mut self.room_name_input);
                if ui
                    .add_sized(
                        [ui.available_width(), 38.0],
                        egui::Button::new(
                            egui::RichText::new("Criar sala de jogo").strong().color(GOLD),
                        ),
                    )
                    .clicked()
                {
                    let name = if self.room_name_input.trim().is_empty() {
                        "Nova aventura".to_string()
                    } else {
                        self.room_name_input.clone()
                    };
                    self.mode = GameMode::Room { name };
                }
                ui.add_space(10.0);
                ui.separator();
                ui.label(egui::RichText::new("Acesso livre").strong().color(GOLD));
                ui.label(
                    egui::RichText::new("Sem bloqueios artificiais por assinatura.")
                        .size(12.0)
                        .color(MUTED),
                );
            });
        });
    }

    fn show_room_panels(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("room_library")
            .default_width(190.0)
            .resizable(true)
            .frame(egui::Frame::none().fill(PANEL).inner_margin(egui::Margin::same(12.0)))
            .show(ctx, |ui| {
                section_title(ui, "Biblioteca");
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("BUSCAR").size(9.0).strong().color(GOLD));
                    ui.label(egui::RichText::new("Conteúdo da mesa").size(12.0).color(MUTED));
                });
                ui.separator();
                for (title, items) in [
                    ("Informações", vec!["Regras da mesa", "Notas da sessão"]),
                    ("Jogadores", vec!["JvBR", "Aventureiro"]),
                    ("Mapas", vec!["Asilo da Vigília", "Sessão 2", "Sessão 3"]),
                    ("Personagens", vec!["Hero Alden"]),
                    ("Monstros", vec!["Bestiário"]),
                ] {
                    egui::CollapsingHeader::new(
                        egui::RichText::new(title).strong().color(TEXT),
                    )
                    .default_open(title == "Mapas" || title == "Jogadores")
                    .show(ui, |ui| {
                        for item in items {
                            ui.horizontal(|ui| {
                                ui.label(egui::RichText::new("›").color(GOLD));
                                ui.label(egui::RichText::new(item).size(12.0).color(MUTED));
                            });
                        }
                    });
                }
            });

        egui::SidePanel::right("room_chat")
            .default_width(285.0)
            .resizable(true)
            .frame(egui::Frame::none().fill(PANEL).inner_margin(egui::Margin::same(12.0)))
            .show(ctx, |ui| {
                section_title(ui, "Chat da mesa");
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("MENSAGENS").size(10.0).strong().color(GOLD));
                    ui.label(egui::RichText::new("Demonstração local").size(10.0).color(MUTED));
                });
                ui.separator();
                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .stick_to_bottom(true)
                    .show(ui, |ui| {
                        for message in &self.chat_messages {
                            ui.label(
                                egui::RichText::new(format!("{}  {}", message.timestamp, message.sender))
                                    .size(11.0)
                                    .strong()
                                    .color(GOLD),
                            );
                            ui.label(egui::RichText::new(&message.text).size(12.0).color(TEXT));
                            ui.add_space(8.0);
                        }
                    });
                ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
                    ui.horizontal(|ui| {
                        let send = ui.button("➤").clicked();
                        let response = ui.add(
                            egui::TextEdit::singleline(&mut self.chat_input)
                                .hint_text("Escreva uma mensagem...")
                                .desired_width(ui.available_width()),
                        );
                        if (send || response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter)))
                            && !self.chat_input.trim().is_empty()
                        {
                            self.chat_messages.push(ChatMessage {
                                sender: "JvBR".to_string(),
                                text: std::mem::take(&mut self.chat_input),
                                timestamp: "Agora".to_string(),
                            });
                        }
                    });
                });
            });
    }

    fn show_room_canvas(&mut self, ui: &mut egui::Ui, name: &str) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(egui::RichText::new("MESA VIRTUAL").size(10.0).strong().color(GOLD));
                ui.heading(name);
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Voltar às mesas").clicked() {
                    self.mode = GameMode::Lobby;
                }
                ui.label(egui::RichText::new("SESSÃO LOCAL").size(11.0).strong().color(GREEN));
            });
        });
        ui.add_space(10.0);
        let available = ui.available_size();
        let (canvas, _) = ui.allocate_exact_size(available, egui::Sense::hover());
        let painter = ui.painter();
        painter.rect_filled(canvas, egui::Rounding::same(8.0), egui::Color32::from_rgb(5, 5, 6));
        painter.rect_stroke(
            canvas,
            egui::Rounding::same(8.0),
            egui::Stroke::new(1.0_f32, egui::Color32::from_rgb(70, 56, 38)),
        );

        let map_size = egui::vec2((canvas.width() * 0.78).min(790.0), (canvas.height() * 0.76).min(430.0));
        let map = egui::Rect::from_center_size(canvas.center(), map_size);
        painter.rect_filled(map, egui::Rounding::same(5.0), egui::Color32::from_rgb(54, 59, 43));
        painter.rect_stroke(map, egui::Rounding::same(5.0), egui::Stroke::new(3.0_f32, egui::Color32::from_rgb(187, 157, 102)));
        let grid_color = egui::Color32::from_rgba_unmultiplied(226, 205, 157, 24);
        let mut x = map.left() + 24.0;
        while x < map.right() {
            painter.line_segment([egui::pos2(x, map.top()), egui::pos2(x, map.bottom())], egui::Stroke::new(1.0_f32, grid_color));
            x += 32.0;
        }
        let mut y = map.top() + 24.0;
        while y < map.bottom() {
            painter.line_segment([egui::pos2(map.left(), y), egui::pos2(map.right(), y)], egui::Stroke::new(1.0_f32, grid_color));
            y += 32.0;
        }

        let river = [
            egui::pos2(map.left() + map.width() * 0.05, map.top() + map.height() * 0.73),
            egui::pos2(map.left() + map.width() * 0.28, map.top() + map.height() * 0.60),
            egui::pos2(map.left() + map.width() * 0.46, map.top() + map.height() * 0.70),
            egui::pos2(map.left() + map.width() * 0.68, map.top() + map.height() * 0.48),
            egui::pos2(map.left() + map.width() * 0.96, map.top() + map.height() * 0.54),
        ];
        painter.add(egui::Shape::line(
            river.to_vec(),
            egui::Stroke::new(17.0_f32, egui::Color32::from_rgb(51, 91, 94)),
        ));
        let road = [
            egui::pos2(map.left() + map.width() * 0.12, map.top() + map.height() * 0.20),
            egui::pos2(map.left() + map.width() * 0.40, map.top() + map.height() * 0.43),
            map.center(),
            egui::pos2(map.left() + map.width() * 0.72, map.top() + map.height() * 0.29),
            egui::pos2(map.left() + map.width() * 0.87, map.top() + map.height() * 0.75),
        ];
        painter.add(egui::Shape::line(
            road.to_vec(),
            egui::Stroke::new(7.0_f32, egui::Color32::from_rgb(141, 119, 78)),
        ));

        for (rx, ry, label) in [
            (0.20, 0.34, "Vila"),
            (0.72, 0.62, "Bosque"),
            (0.81, 0.24, "Ruínas"),
            (0.28, 0.78, "Ponte"),
        ] {
            let point = egui::pos2(map.left() + map.width() * rx, map.top() + map.height() * ry);
            painter.circle_filled(point, 11.0, egui::Color32::from_rgb(94, 69, 43));
            painter.circle_stroke(point, 11.0, egui::Stroke::new(2.0_f32, GOLD));
            painter.text(
                point + egui::vec2(16.0, -6.0),
                egui::Align2::LEFT_CENTER,
                label,
                egui::FontId::proportional(12.0),
                TEXT,
            );
        }

        let castle = egui::Rect::from_center_size(map.center(), egui::vec2(88.0, 62.0));
        painter.rect_filled(castle, egui::Rounding::same(2.0), egui::Color32::from_rgb(112, 82, 54));
        painter.rect_stroke(castle, egui::Rounding::same(2.0), egui::Stroke::new(2.0_f32, egui::Color32::from_rgb(228, 194, 128)));
        for dx in [-34.0, 34.0] {
            let tower = egui::Rect::from_center_size(castle.center() + egui::vec2(dx, -18.0), egui::vec2(22.0, 27.0));
            painter.rect_filled(tower, egui::Rounding::same(2.0), egui::Color32::from_rgb(137, 96, 59));
            painter.rect_stroke(tower, egui::Rounding::same(2.0), egui::Stroke::new(1.0_f32, GOLD));
        }
        painter.text(
            egui::pos2(map.center().x, map.bottom() + 20.0),
            egui::Align2::CENTER_CENTER,
            "ASILO DA VIGÍLIA",
            egui::FontId::proportional(13.0),
            GOLD,
        );
        painter.text(
            canvas.left_top() + egui::vec2(18.0, 16.0),
            egui::Align2::LEFT_TOP,
            "MAPA  •  ASILO DA VIGÍLIA",
            egui::FontId::proportional(11.0),
            GOLD,
        );
        painter.text(
            canvas.right_bottom() - egui::vec2(16.0, 14.0),
            egui::Align2::RIGHT_BOTTOM,
            "Grade  •  100%",
            egui::FontId::proportional(11.0),
            MUTED,
        );

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            for tool in ["Selecionar", "Desenhar", "Marcador", "Grade", "Dados"] {
                let _ = ui.button(tool);
            }
        });
    }

    fn show_character_sheet(&mut self, ui: &mut egui::Ui) {
        section_title(ui, "Biblioteca de heróis");
        ui.heading("Ficha de personagem");
        ui.label(egui::RichText::new("Seus aventureiros e seus atributos.").color(MUTED));
        ui.add_space(14.0);
        if let Some(character) = self.characters.get_mut(self.selected_char) {
            card_frame().show(ui, |ui| {
                ui.horizontal(|ui| {
                    egui::Frame::none()
                        .fill(WINE)
                        .stroke(egui::Stroke::new(1.0_f32, GOLD_DIM))
                        .rounding(egui::Rounding::same(8.0))
                        .inner_margin(egui::Margin::same(17.0))
                        .show(ui, |ui| {
                            ui.label(                            egui::RichText::new("H").size(32.0).strong().color(GOLD));
                        });
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new(&character.name).size(22.0).strong());
                        ui.label(egui::RichText::new(format!("{}  •  Nível {}", character.class, character.level)).color(GOLD));
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("＋  Subir nível").clicked() {
                            character.level += 1;
                        }
                        ui.label(egui::RichText::new(format!("♥  {} / {} PV", character.hp, character.max_hp)).strong().color(egui::Color32::from_rgb(207, 100, 84)));
                    });
                });
                ui.separator();
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("NOME").size(10.0).strong().color(GOLD_DIM));
                        ui.text_edit_singleline(&mut character.name);
                    });
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("CLASSE").size(10.0).strong().color(GOLD_DIM));
                        ui.text_edit_singleline(&mut character.class);
                    });
                });
                ui.add_space(8.0);
                section_title(ui, "Atributos");
                ui.columns(6, |columns| {
                    for (column, (label, value)) in columns.iter_mut().zip([
                        ("FOR", character.strength),
                        ("DES", character.dexterity),
                        ("CON", character.constitution),
                        ("INT", character.intelligence),
                        ("SAB", character.wisdom),
                        ("CAR", character.charisma),
                    ]) {
                        egui::Frame::none()
                            .fill(PANEL_RAISED)
                            .rounding(egui::Rounding::same(6.0))
                            .inner_margin(egui::Margin::same(11.0))
                            .show(column, |ui| {
                                ui.vertical_centered(|ui| {
                                    ui.label(egui::RichText::new(label).size(10.0).strong().color(GOLD));
                                    ui.label(egui::RichText::new(value.to_string()).size(22.0).strong());
                                });
                            });
                    }
                });
            });
        }
    }

    fn show_dice_roller(&mut self, ui: &mut egui::Ui) {
        section_title(ui, "Ferramentas da mesa");
        ui.heading("Rolagem de dados");
        ui.label(egui::RichText::new("Configure a rolagem e compartilhe o resultado com o grupo.").color(MUTED));
        ui.add_space(16.0);
        card_frame().show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    section_title(ui, "Quantidade");
                    ui.add(egui::DragValue::new(&mut self.dice_count).range(1..=20).prefix("d"));
                });
                ui.vertical(|ui| {
                    section_title(ui, "Faces");
                    ui.add(egui::DragValue::new(&mut self.dice_sides).range(2..=100).suffix(" faces"));
                });
                ui.add_space(16.0);
                if ui
                    .add_sized(
                        [155.0, 44.0],
                        egui::Button::new(egui::RichText::new("Rolar dados").strong().color(GOLD)),
                    )
                    .clicked()
                {
                    let mut rng = rand::thread_rng();
                    self.dice_results = (0..self.dice_count)
                        .map(|_| rng.gen_range(1..=self.dice_sides))
                        .collect();
                    self.dice_total = self.dice_results.iter().sum();
                }
            });
            ui.add_space(14.0);
            ui.separator();
            if self.dice_results.is_empty() {
                ui.label(egui::RichText::new("Sua próxima rolagem aparecerá aqui.").color(MUTED));
            } else {
                ui.label(egui::RichText::new("RESULTADO").size(11.0).strong().color(GOLD));
                ui.horizontal(|ui| {
                    for result in &self.dice_results {
                        egui::Frame::none()
                            .fill(WINE)
                            .stroke(egui::Stroke::new(1.0_f32, GOLD_DIM))
                            .rounding(egui::Rounding::same(8.0))
                            .inner_margin(egui::Margin::same(13.0))
                            .show(ui, |ui| {
                                ui.label(egui::RichText::new(result.to_string()).size(22.0).strong().color(TEXT));
                            });
                    }
                    ui.label(egui::RichText::new(format!("Total: {}", self.dice_total)).size(20.0).strong().color(GOLD));
                });
            }
        });
    }

    fn show_chat(&mut self, ui: &mut egui::Ui) {
        section_title(ui, "Comunicação");
        ui.heading("Chat da mesa");
        ui.label(egui::RichText::new("Mensagens desta sessão local.").color(MUTED));
        ui.add_space(12.0);
        card_frame().show(ui, |ui| {
            egui::ScrollArea::vertical().max_height(380.0).show(ui, |ui| {
                for message in &self.chat_messages {
                    ui.label(egui::RichText::new(format!("{}  •  {}", message.sender, message.timestamp)).strong().color(GOLD));
                    ui.label(&message.text);
                    ui.separator();
                }
            });
            ui.horizontal(|ui| {
                let response = ui.add_sized(
                    [ui.available_width() - 90.0, 36.0],
                    egui::TextEdit::singleline(&mut self.chat_input).hint_text("Escreva uma mensagem..."),
                );
                if ui.button("Enviar  ➤").clicked()
                    || response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter))
                {
                    if !self.chat_input.trim().is_empty() {
                        self.chat_messages.push(ChatMessage {
                            sender: "JvBR".to_string(),
                            text: std::mem::take(&mut self.chat_input),
                            timestamp: "Agora".to_string(),
                        });
                    }
                }
            });
        });
    }

    fn show_campaigns(&mut self, ui: &mut egui::Ui) {
        section_title(ui, "Mestre");
        ui.heading("Campanhas e anotações");
        ui.label(egui::RichText::new("Organize o cenário e registre as ideias da sessão.").color(MUTED));
        ui.add_space(14.0);
        card_frame().show(ui, |ui| {
            ui.label(egui::RichText::new("A ÚLTIMA VIGÍLIA").size(11.0).strong().color(GOLD));
            ui.add_space(5.0);
            ui.label(egui::RichText::new("Sessão atual  •  O caminho para o leste").size(18.0).strong());
            ui.separator();
            ui.label(egui::RichText::new("Notas e lore").strong().color(GOLD));
            ui.add_sized(
                [ui.available_width(), 200.0],
                egui::TextEdit::multiline(&mut self.campaign_notes)
                    .hint_text("Anote acontecimentos, personagens e pistas..."),
            );
        });
    }

    fn show_moderation(&mut self, ui: &mut egui::Ui) {
        section_title(ui, "Controles da mesa");
        ui.heading("Moderação");
        ui.label(egui::RichText::new("Controles locais para organizar participantes.").color(MUTED));
        ui.add_space(14.0);
        card_frame().show(ui, |ui| {
            ui.label(egui::RichText::new("Silenciar participante").strong().color(GOLD));
            ui.horizontal(|ui| {
                ui.add_sized(
                    [270.0, 34.0],
                    egui::TextEdit::singleline(&mut self.moderation_input)
                        .hint_text("Nome do participante"),
                );
                if ui.button("Silenciar").clicked() && !self.moderation_input.trim().is_empty() {
                    let name = std::mem::take(&mut self.moderation_input);
                    if !self.muted_users.contains(&name) {
                        self.muted_users.push(name);
                    }
                }
                if ui.button("Banir").clicked() && !self.moderation_input.trim().is_empty() {
                    self.ban_list.push(std::mem::take(&mut self.moderation_input));
                }
            });
            ui.separator();
            ui.columns(2, |columns| {
                columns[0].label(egui::RichText::new("SILENCIADOS").size(11.0).strong().color(GOLD));
                for user in &self.muted_users {
                    columns[0].label(format!("●  {user}"));
                }
                columns[1].label(egui::RichText::new("BANIDOS").size(11.0).strong().color(GOLD));
                for user in &self.ban_list {
                    columns[1].label(format!("⊘  {user}"));
                }
            });
            ui.add_space(8.0);
            ui.label(
                egui::RichText::new("Estas ações são apenas locais neste protótipo; não afetam outros usuários.")
                    .size(11.0)
                    .color(MUTED),
            );
        });
    }
}

impl eframe::App for RrpgApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.frame_count += 1;
        apply_theme(ctx);

        let screenshot = ctx.input(|input| {
            input.raw.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let (Some(path), Some(screenshot)) = (&self.screenshot_path, screenshot) {
            let rgba: Vec<u8> = screenshot
                .pixels
                .iter()
                .flat_map(|pixel| pixel.to_array())
                .collect();
            if let Err(error) = image::save_buffer(
                path,
                &rgba,
                screenshot.size[0] as u32,
                screenshot.size[1] as u32,
                image::ColorType::Rgba8,
            ) {
                eprintln!("Failed to save screenshot to {path:?}: {error}");
                std::process::exit(1);
            }
            std::process::exit(0);
        }

        egui::TopBottomPanel::top("top_panel")
            .exact_height(78.0)
            .frame(
                egui::Frame::none()
                    .fill(WINE)
                    .stroke(egui::Stroke::new(1.0_f32, GOLD_DIM))
                    .inner_margin(egui::Margin::symmetric(18.0, 10.0)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    egui::Frame::none()
                        .fill(egui::Color32::from_rgb(86, 35, 18))
                        .stroke(egui::Stroke::new(1.0_f32, GOLD))
                        .rounding(egui::Rounding::same(8.0))
                        .inner_margin(egui::Margin::same(7.0))
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new("R").size(23.0).strong().color(GOLD));
                        });
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new("R R P G").size(18.0).strong().color(TEXT));
                        ui.label(
                            egui::RichText::new("MESA VIRTUAL")
                                .size(10.0)
                                .strong()
                                .color(GOLD),
                        );
                    });
                    ui.add_space(16.0);
                    ui.separator();
                    let nav = [
                        ("Mesas", 0),
                        ("Personagens", 1),
                        ("Dados", 2),
                        ("Chat", 3),
                        ("Campanhas", 4),
                        ("Moderação", 5),
                    ];
                    for (label, destination) in nav {
                        let active = match destination {
                            0 => matches!(&self.mode, GameMode::Lobby | GameMode::Room { .. }),
                            1 => matches!(&self.mode, GameMode::CharacterSheet),
                            2 => matches!(&self.mode, GameMode::DiceRoller),
                            3 => matches!(&self.mode, GameMode::Chat),
                            4 => matches!(&self.mode, GameMode::CampaignManager),
                            _ => matches!(&self.mode, GameMode::Moderation),
                        };
                        if ui
                            .selectable_label(
                                active,
                                egui::RichText::new(label)
                                    .strong()
                                    .color(if active { GOLD } else { TEXT }),
                            )
                            .clicked()
                        {
                            self.mode = match destination {
                                0 => GameMode::Lobby,
                                1 => GameMode::CharacterSheet,
                                2 => GameMode::DiceRoller,
                                3 => GameMode::Chat,
                                4 => GameMode::CampaignManager,
                                _ => GameMode::Moderation,
                            };
                        }
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(egui::RichText::new("JvBR").strong().color(TEXT));
                        ui.label(egui::RichText::new("LOCAL").size(10.0).strong().color(GREEN));
                        egui::Frame::none()
                            .fill(egui::Color32::from_rgb(79, 45, 37))
                            .rounding(egui::Rounding::same(20.0))
                            .inner_margin(egui::Margin::same(8.0))
                            .show(ui, |ui| {
                                ui.label(egui::RichText::new("JB").strong().color(GOLD));
                            });
                    });
                });
            });

        egui::TopBottomPanel::bottom("status_bar")
            .exact_height(27.0)
            .frame(egui::Frame::none().fill(PANEL))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("OFFLINE").size(10.0).strong().color(MUTED));
                    ui.label(egui::RichText::new("Sessão local").size(11.0).color(MUTED));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(
                            egui::RichText::new("RRPG  •  protótipo local")
                                .size(11.0)
                                .color(MUTED),
                        );
                    });
                });
            });

        let current_mode = self.mode.clone();
        if matches!(&current_mode, GameMode::Room { .. }) {
            self.show_room_panels(ctx);
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(BG).inner_margin(egui::Margin::same(18.0)))
            .show(ctx, |ui| match current_mode {
                GameMode::Lobby => self.show_lobby(ui),
                GameMode::Room { name } => self.show_room_canvas(ui, &name),
                GameMode::CharacterSheet => self.show_character_sheet(ui),
                GameMode::DiceRoller => self.show_dice_roller(ui),
                GameMode::Chat => self.show_chat(ui),
                GameMode::CampaignManager => self.show_campaigns(ui),
                GameMode::Moderation => self.show_moderation(ui),
            });

        if self.screenshot_path.is_some() && !self.screenshot_requested && self.frame_count >= 5 {
            self.screenshot_requested = true;
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot);
            ctx.request_repaint();
        }
    }
}

fn main() -> Result<(), eframe::Error> {
    let args = Args::parse();
    let mut options = eframe::NativeOptions::default();
    options.viewport.inner_size = Some(egui::vec2(1440.0, 900.0));
    options.viewport.min_inner_size = Some(egui::vec2(960.0, 640.0));
    
    if args.screenshot.is_some() {
        options.viewport.inner_size = Some(egui::vec2(1280.0, 720.0));
        options.viewport.resizable = Some(false);
    }
    
    let screenshot_path = args.screenshot;
    
    eframe::run_native(
        "RRPG Virtual Tabletop",
        options,
        Box::new(move |_cc| {
            let mut app = RrpgApp::default();
            app.screenshot_path = screenshot_path;
            Ok(Box::new(app))
        }),
    )
}
