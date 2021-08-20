/**
 * External dependencies
 */
import classnames from 'classnames';
import { escape } from 'lodash';

/**
 * WordPress dependencies
 */
import { createBlock } from '@wordpress/blocks';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	PanelBody,
	Popover,
	TextControl,
	TextareaControl,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import { displayShortcut, isKeyboardEvent, ENTER } from '@wordpress/keycodes';
import { __, sprintf } from '@wordpress/i18n';
import {
	BlockControls,
	InnerBlocks,
	__experimentalUseInnerBlocksProps as useInnerBlocksProps,
	InspectorControls,
	RichText,
	__experimentalLinkControl as LinkControl,
	useBlockProps,
	store as blockEditorStore,
	getColorClassName,
} from '@wordpress/block-editor';
import { isURL, prependHTTP, safeDecodeURI } from '@wordpress/url';
import {
	Fragment,
	useState,
	useEffect,
	useRef,
	createInterpolateElement,
} from '@wordpress/element';
import { placeCaretAtHorizontalEdge } from '@wordpress/dom';
import { link as linkIcon, addSubmenu } from '@wordpress/icons';
import { store as coreStore } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import { ItemSubmenuIcon } from './icons';
import { name } from './block.json';

const ALLOWED_BLOCKS = [ 'core/navigation-link' ];

const MAX_NESTING = 5;

/**
 * A React hook to determine if it's dragging within the target element.
 *
 * @typedef {import('@wordpress/element').RefObject} RefObject
 *
 * @param {RefObject<HTMLElement>} elementRef The target elementRef object.
 *
 * @return {boolean} Is dragging within the target element.
 */
const useIsDraggingWithin = ( elementRef ) => {
	const [ isDraggingWithin, setIsDraggingWithin ] = useState( false );

	useEffect( () => {
		const { ownerDocument } = elementRef.current;

		function handleDragStart( event ) {
			// Check the first time when the dragging starts.
			handleDragEnter( event );
		}

		// Set to false whenever the user cancel the drag event by either releasing the mouse or press Escape.
		function handleDragEnd() {
			setIsDraggingWithin( false );
		}

		function handleDragEnter( event ) {
			// Check if the current target is inside the item element.
			if ( elementRef.current.contains( event.target ) ) {
				setIsDraggingWithin( true );
			} else {
				setIsDraggingWithin( false );
			}
		}

		// Bind these events to the document to catch all drag events.
		// Ideally, we can also use `event.relatedTarget`, but sadly that
		// doesn't work in Safari.
		ownerDocument.addEventListener( 'dragstart', handleDragStart );
		ownerDocument.addEventListener( 'dragend', handleDragEnd );
		ownerDocument.addEventListener( 'dragenter', handleDragEnter );

		return () => {
			ownerDocument.removeEventListener( 'dragstart', handleDragStart );
			ownerDocument.removeEventListener( 'dragend', handleDragEnd );
			ownerDocument.removeEventListener( 'dragenter', handleDragEnter );
		};
	}, [] );

	return isDraggingWithin;
};

/**
 * Given the Link block's type attribute, return the query params to give to
 * /wp/v2/search.
 *
 * @param {string} type Link block's type attribute.
 * @param {string} kind Link block's entity of kind (post-type|taxonomy)
 * @return {{ type?: string, subtype?: string }} Search query params.
 */
function getSuggestionsQuery( type, kind ) {
	switch ( type ) {
		case 'post':
		case 'page':
			return { type: 'post', subtype: type };
		case 'category':
			return { type: 'term', subtype: 'category' };
		case 'tag':
			return { type: 'term', subtype: 'post_tag' };
		case 'post_format':
			return { type: 'post-format' };
		default:
			if ( kind === 'taxonomy' ) {
				return { type: 'term', subtype: type };
			}
			if ( kind === 'post-type' ) {
				return { type: 'post', subtype: type };
			}
			return {};
	}
}

/**
 * Determine the colors for a menu.
 *
 * Order of priority is:
 * 1: Overlay custom colors (if submenu)
 * 2: Overlay theme colors (if submenu)
 * 3: Custom colors
 * 4: Theme colors
 * 5: Global styles
 *
 * @param {Object}  context
 * @param {boolean} isSubMenu
 */
function getColors( context, isSubMenu ) {
	const {
		textColor,
		customTextColor,
		backgroundColor,
		customBackgroundColor,
		overlayTextColor,
		customOverlayTextColor,
		overlayBackgroundColor,
		customOverlayBackgroundColor,
		style,
	} = context;

	const colors = {};

	if ( isSubMenu && !! customOverlayTextColor ) {
		colors.customTextColor = customOverlayTextColor;
	} else if ( isSubMenu && !! overlayTextColor ) {
		colors.textColor = overlayTextColor;
	} else if ( !! customTextColor ) {
		colors.customTextColor = customTextColor;
	} else if ( !! textColor ) {
		colors.textColor = textColor;
	} else if ( !! style?.color?.text ) {
		colors.customTextColor = style.color.text;
	}

	if ( isSubMenu && !! customOverlayBackgroundColor ) {
		colors.customBackgroundColor = customOverlayBackgroundColor;
	} else if ( isSubMenu && !! overlayBackgroundColor ) {
		colors.backgroundColor = overlayBackgroundColor;
	} else if ( !! customBackgroundColor ) {
		colors.customBackgroundColor = customBackgroundColor;
	} else if ( !! backgroundColor ) {
		colors.backgroundColor = backgroundColor;
	} else if ( !! style?.color?.background ) {
		colors.customTextColor = style.color.background;
	}

	return colors;
}

/**
 * @typedef {'post-type'|'custom'|'taxonomy'|'post-type-archive'} WPNavigationLinkKind
 */

/**
 * Navigation Link Block Attributes
 *
 * @typedef {Object} WPNavigationLinkBlockAttributes
 *
 * @property {string}               [label]         Link text.
 * @property {WPNavigationLinkKind} [kind]          Kind is used to differentiate between term and post ids to check post draft status.
 * @property {string}               [type]          The type such as post, page, tag, category and other custom types.
 * @property {string}               [rel]           The relationship of the linked URL.
 * @property {number}               [id]            A post or term id.
 * @property {boolean}              [opensInNewTab] Sets link target to _blank when true.
 * @property {string}               [url]           Link href.
 * @property {string}               [title]         Link title attribute.
 */

/**
 * Link Control onChange handler that updates block attributes when a setting is changed.
 *
 * @param {Object}                          updatedValue    New block attributes to update.
 * @param {Function}                        setAttributes   Block attribute update function.
 * @param {WPNavigationLinkBlockAttributes} blockAttributes Current block attributes.
 *
 */
export const updateNavigationLinkBlockAttributes = (
	updatedValue = {},
	setAttributes,
	blockAttributes = {}
) => {
	const {
		label: originalLabel = '',
		kind: originalKind = '',
		type: originalType = '',
	} = blockAttributes;
	const {
		title = '',
		url = '',
		opensInNewTab,
		id,
		kind: newKind = originalKind,
		type: newType = originalType,
	} = updatedValue;

	const normalizedTitle = title.replace( /http(s?):\/\//gi, '' );
	const normalizedURL = url.replace( /http(s?):\/\//gi, '' );
	const escapeTitle =
		title !== '' &&
		normalizedTitle !== normalizedURL &&
		originalLabel !== title;
	const label = escapeTitle
		? escape( title )
		: originalLabel || escape( normalizedURL );

	// In https://github.com/WordPress/gutenberg/pull/24670 we decided to use "tag" in favor of "post_tag"
	const type = newType === 'post_tag' ? 'tag' : newType.replace( '-', '_' );

	const isBuiltInType =
		[ 'post', 'page', 'tag', 'category' ].indexOf( type ) > -1;

	const isCustomLink =
		( ! newKind && ! isBuiltInType ) || newKind === 'custom';
	const kind = isCustomLink ? 'custom' : newKind;

	setAttributes( {
		// Passed `url` may already be encoded. To prevent double encoding, decodeURI is executed to revert to the original string.
		...( url && { url: encodeURI( safeDecodeURI( url ) ) } ),
		...( label && { label } ),
		...( undefined !== opensInNewTab && { opensInNewTab } ),
		...( id && Number.isInteger( id ) && { id } ),
		...( kind && { kind } ),
		...( type && type !== 'URL' && { type } ),
	} );
};

export default function NavigationLinkEdit( {
	attributes,
	isSelected,
	setAttributes,
	insertBlocksAfter,
	mergeBlocks,
	onReplace,
	context,
	clientId,
} ) {
	const {
		label,
		type,
		opensInNewTab,
		url,
		description,
		rel,
		title,
		kind,
	} = attributes;
	const link = {
		url,
		opensInNewTab,
	};
	const { showSubmenuIcon } = context;
	const { saveEntityRecord } = useDispatch( coreStore );
	const { replaceBlock } = useDispatch( blockEditorStore );
	const [ isLinkOpen, setIsLinkOpen ] = useState( false );
	const listItemRef = useRef( null );
	const isDraggingWithin = useIsDraggingWithin( listItemRef );
	const itemLabelPlaceholder = __( 'Add link…' );
	const ref = useRef();

	const {
		isAtMaxNesting,
		isTopLevelLink,
		isParentOfSelectedBlock,
		isImmediateParentOfSelectedBlock,
		hasDescendants,
		selectedBlockHasDescendants,
		userCanCreatePages,
		userCanCreatePosts,
	} = useSelect(
		( select ) => {
			const {
				getClientIdsOfDescendants,
				hasSelectedInnerBlock,
				getSelectedBlockClientId,
				getBlockParentsByBlockName,
			} = select( blockEditorStore );

			const selectedBlockId = getSelectedBlockClientId();

			const descendants = getClientIdsOfDescendants( [ clientId ] )
				.length;

			return {
				isAtMaxNesting:
					getBlockParentsByBlockName( clientId, name ).length >=
					MAX_NESTING,
				isTopLevelLink:
					getBlockParentsByBlockName( clientId, name ).length === 0,
				isParentOfSelectedBlock: hasSelectedInnerBlock(
					clientId,
					true
				),
				isImmediateParentOfSelectedBlock: hasSelectedInnerBlock(
					clientId,
					false
				),
				hasDescendants: !! descendants,
				selectedBlockHasDescendants: !! getClientIdsOfDescendants( [
					selectedBlockId,
				] )?.length,
				userCanCreatePages: select( coreStore ).canUser(
					'create',
					'pages'
				),
				userCanCreatePosts: select( coreStore ).canUser(
					'create',
					'posts'
				),
			};
		},
		[ clientId ]
	);

	// Store the colors from context as attributes for rendering
	useEffect( () => setAttributes( { isTopLevelLink } ), [ isTopLevelLink ] );

	/**
	 * Transform to submenu block.
	 */
	function transformToSubmenu() {
		const newSubmenu = createBlock( 'core/navigation-submenu', attributes );
		replaceBlock( clientId, newSubmenu );
	}

	// Show the LinkControl on mount if the URL is empty
	// ( When adding a new menu item)
	// This can't be done in the useState call because it conflicts
	// with the autofocus behavior of the BlockListBlock component.
	useEffect( () => {
		if ( ! url ) {
			setIsLinkOpen( true );
		}
	}, [] );

	/**
	 * The hook shouldn't be necessary but due to a focus loss happening
	 * when selecting a suggestion in the link popover, we force close on block unselection.
	 */
	useEffect( () => {
		if ( ! isSelected ) {
			setIsLinkOpen( false );
		}
	}, [ isSelected ] );

	// If the LinkControl popover is open and the URL has changed, close the LinkControl and focus the label text.
	useEffect( () => {
		if ( isLinkOpen && url ) {
			// Does this look like a URL and have something TLD-ish?
			if (
				isURL( prependHTTP( label ) ) &&
				/^.+\.[a-z]+/.test( label )
			) {
				// Focus and select the label text.
				selectLabelText();
			} else {
				// Focus it (but do not select).
				placeCaretAtHorizontalEdge( ref.current, true );
			}
		}
	}, [ url ] );

	/**
	 * Focus the Link label text and select it.
	 */
	function selectLabelText() {
		ref.current.focus();
		const { ownerDocument } = ref.current;
		const { defaultView } = ownerDocument;
		const selection = defaultView.getSelection();
		const range = ownerDocument.createRange();
		// Get the range of the current ref contents so we can add this range to the selection.
		range.selectNodeContents( ref.current );
		selection.removeAllRanges();
		selection.addRange( range );
	}

	/**
	 * Removes the current link if set.
	 */
	function removeLink() {
		// Reset all attributes that comprise the link.
		setAttributes( {
			url: '',
			label: '',
			id: '',
			kind: '',
			type: '',
		} );

		// Close the link editing UI.
		setIsLinkOpen( false );
	}

	let userCanCreate = false;
	if ( ! type || type === 'page' ) {
		userCanCreate = userCanCreatePages;
	} else if ( type === 'post' ) {
		userCanCreate = userCanCreatePosts;
	}

	async function handleCreate( pageTitle ) {
		const postType = type || 'page';

		const page = await saveEntityRecord( 'postType', postType, {
			title: pageTitle,
			status: 'draft',
		} );

		return {
			id: page.id,
			type: postType,
			title: page.title.rendered,
			url: page.link,
			kind: 'post-type',
		};
	}

	const {
		textColor,
		customTextColor,
		backgroundColor,
		customBackgroundColor,
	} = getColors( context, ! isTopLevelLink );

	function onKeyDown( event ) {
		if (
			isKeyboardEvent.primary( event, 'k' ) ||
			( ! url && event.keyCode === ENTER )
		) {
			setIsLinkOpen( true );
		}
	}

	const blockProps = useBlockProps( {
		ref: listItemRef,
		className: classnames( 'wp-block-navigation-item', {
			'is-editing': isSelected || isParentOfSelectedBlock,
			'is-dragging-within': isDraggingWithin,
			'has-link': !! url,
			'has-child': hasDescendants,
			'has-text-color': !! textColor || !! customTextColor,
			[ getColorClassName( 'color', textColor ) ]: !! textColor,
			'has-background': !! backgroundColor || customBackgroundColor,
			[ getColorClassName(
				'background-color',
				backgroundColor
			) ]: !! backgroundColor,
		} ),
		style: {
			color: ! textColor && customTextColor,
			backgroundColor: ! backgroundColor && customBackgroundColor,
		},
		onKeyDown,
	} );

	if ( ! url ) {
		blockProps.onClick = () => setIsLinkOpen( true );
	}

	// Always use overlay colors for submenus
	const innerBlocksColors = getColors( context, true );
	const innerBlocksProps = useInnerBlocksProps(
		{
			className: classnames(
				'wp-block-navigation-link__container',
				'wp-block-navigation__submenu-container',
				{
					'is-parent-of-selected-block': isParentOfSelectedBlock,
					'has-text-color': !! (
						innerBlocksColors.textColor ||
						innerBlocksColors.customTextColor
					),
					[ `has-${ innerBlocksColors.textColor }-color` ]: !! innerBlocksColors.textColor,
					'has-background': !! (
						innerBlocksColors.backgroundColor ||
						innerBlocksColors.customBackgroundColor
					),
					[ `has-${ innerBlocksColors.backgroundColor }-background-color` ]: !! innerBlocksColors.backgroundColor,
				}
			),
			style: {
				color: innerBlocksColors.customTextColor,
				backgroundColor: innerBlocksColors.customBackgroundColor,
			},
		},
		{
			allowedBlocks: ALLOWED_BLOCKS,
			renderAppender:
				( isSelected && hasDescendants ) ||
				( isImmediateParentOfSelectedBlock &&
					! selectedBlockHasDescendants ) ||
				// Show the appender while dragging to allow inserting element between item and the appender.
				hasDescendants
					? InnerBlocks.DefaultAppender
					: false,
		}
	);

	const classes = classnames(
		'wp-block-navigation-link__content',
		'wp-block-navigation-item__content',
		{
			'wp-block-navigation-link__placeholder': ! url,
		}
	);

	let missingText = '';
	switch ( type ) {
		case 'post':
			/* translators: label for missing post in navigation link block */
			missingText = __( 'Select post' );
			break;
		case 'page':
			/* translators: label for missing page in navigation link block */
			missingText = __( 'Select page' );
			break;
		case 'category':
			/* translators: label for missing category in navigation link block */
			missingText = __( 'Select category' );
			break;
		case 'tag':
			/* translators: label for missing tag in navigation link block */
			missingText = __( 'Select tag' );
			break;
		default:
			/* translators: label for missing values in navigation link block */
			missingText = __( 'Add link' );
	}

	return (
		<Fragment>
			<BlockControls>
				<ToolbarGroup>
					<ToolbarButton
						name="link"
						icon={ linkIcon }
						title={ __( 'Link' ) }
						shortcut={ displayShortcut.primary( 'k' ) }
						onClick={ () => setIsLinkOpen( true ) }
					/>
					{ ! isAtMaxNesting && (
						<ToolbarButton
							name="submenu"
							icon={ addSubmenu }
							title={ __( 'Add submenu' ) }
							onClick={ transformToSubmenu }
						/>
					) }
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody title={ __( 'Link settings' ) }>
					<TextareaControl
						value={ description || '' }
						onChange={ ( descriptionValue ) => {
							setAttributes( { description: descriptionValue } );
						} }
						label={ __( 'Description' ) }
						help={ __(
							'The description will be displayed in the menu if the current theme supports it.'
						) }
					/>
					<TextControl
						value={ title || '' }
						onChange={ ( titleValue ) => {
							setAttributes( { title: titleValue } );
						} }
						label={ __( 'Link title' ) }
						autoComplete="off"
					/>
					<TextControl
						value={ rel || '' }
						onChange={ ( relValue ) => {
							setAttributes( { rel: relValue } );
						} }
						label={ __( 'Link rel' ) }
						autoComplete="off"
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				{ /* eslint-disable jsx-a11y/anchor-is-valid */ }
				<a className={ classes }>
					{ /* eslint-enable */ }
					{ ! url ? (
						<div className="wp-block-navigation-link__placeholder-text">
							{ missingText }
						</div>
					) : (
						<RichText
							ref={ ref }
							identifier="label"
							className="wp-block-navigation-link__label"
							value={ label }
							onChange={ ( labelValue ) =>
								setAttributes( { label: labelValue } )
							}
							onMerge={ mergeBlocks }
							onReplace={ onReplace }
							__unstableOnSplitAtEnd={ () =>
								insertBlocksAfter(
									createBlock( 'core/navigation-link' )
								)
							}
							aria-label={ __( 'Navigation link text' ) }
							placeholder={ itemLabelPlaceholder }
							withoutInteractiveFormatting
							allowedFormats={ [
								'core/bold',
								'core/italic',
								'core/image',
								'core/strikethrough',
							] }
							onClick={ () => {
								if ( ! url ) {
									setIsLinkOpen( true );
								}
							} }
						/>
					) }
					{ isLinkOpen && (
						<Popover
							position="bottom center"
							onClose={ () => setIsLinkOpen( false ) }
							anchorRef={ listItemRef.current }
						>
							<LinkControl
								className="wp-block-navigation-link__inline-link-input"
								value={ link }
								showInitialSuggestions={ true }
								withCreateSuggestion={ userCanCreate }
								createSuggestion={ handleCreate }
								createSuggestionButtonText={ ( searchTerm ) => {
									let format;
									if ( type === 'post' ) {
										/* translators: %s: search term. */
										format = __(
											'Create draft post: <mark>%s</mark>'
										);
									} else {
										/* translators: %s: search term. */
										format = __(
											'Create draft page: <mark>%s</mark>'
										);
									}
									return createInterpolateElement(
										sprintf( format, searchTerm ),
										{ mark: <mark /> }
									);
								} }
								noDirectEntry={ !! type }
								noURLSuggestion={ !! type }
								suggestionsQuery={ getSuggestionsQuery(
									type,
									kind
								) }
								onChange={ ( updatedValue ) =>
									updateNavigationLinkBlockAttributes(
										updatedValue,
										setAttributes,
										attributes
									)
								}
								onRemove={ removeLink }
							/>
						</Popover>
					) }
					{ hasDescendants && showSubmenuIcon && (
						<span className="wp-block-navigation-link__submenu-icon wp-block-navigation__submenu-icon">
							<ItemSubmenuIcon />
						</span>
					) }
				</a>
				<div { ...innerBlocksProps } />
			</div>
		</Fragment>
	);
}
