/**
 * External dependencies
 */
import {
	TextInput,
	Text,
	View,
	TouchableOpacity,
	Platform,
	useColorScheme,
} from 'react-native';

/**
 * WordPress dependencies
 */
import { useState, useRef, useMemo, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Gridicons } from '@wordpress/components';
import {
	Icon,
	cancelCircleFilled as cancelCircleFilledIcon,
	arrowLeft as arrowLeftIcon,
	close as closeIcon,
} from '@wordpress/icons';

/**
 * Internal dependencies
 */
import baseStyles from './style.scss';
import platformStyles from './searchFormStyles.scss';

// Merge platform specific styles
for ( const selector in platformStyles ) {
	baseStyles[ selector ] = {
		...baseStyles[ selector ],
		...platformStyles[ selector ],
	};
}

function selectModifiedStyles( styles, modifier ) {
	const modifierMatcher = new RegExp( `--${ modifier }$` );
	const modifierSelectors = Object.keys( styles ).filter( ( selector ) =>
		selector.match( modifierMatcher )
	);

	return modifierSelectors.reduce( ( modifiedStyles, modifierSelector ) => {
		const blockElementSelector = modifierSelector.split( '--' )[ 0 ];
		modifiedStyles[ blockElementSelector ] = styles[ modifierSelector ];
		return modifiedStyles;
	}, {} );
}

function mergeStyles( styles, updateStyles, selectors ) {
	selectors.forEach( ( selector ) => {
		styles[ selector ] = {
			...styles[ selector ],
			...updateStyles[ selector ],
		};
	} );

	return styles;
}

function InserterSearchForm( { value, onChange } ) {
	const [ isActive, setIsActive ] = useState( false );
	const [ currentStyles, setCurrentStyles ] = useState( baseStyles );

	const isDark = useColorScheme() === 'dark';
	const inputRef = useRef();

	const isIOS = Platform.OS === 'ios';

	const darkStyles = useMemo( () => {
		return selectModifiedStyles( baseStyles, 'dark' );
	}, [] );

	const activeStyles = useMemo( () => {
		return selectModifiedStyles( baseStyles, 'active' );
	}, [] );

	const activeDarkStyles = useMemo( () => {
		return selectModifiedStyles( baseStyles, 'active-dark' );
	}, [] );

	useEffect( () => {
		let futureStyles = { ...baseStyles };

		function mergeFutureStyles( modifiedStyles, shouldUseConditions ) {
			const shouldUseModified = shouldUseConditions.every(
				( should ) => should
			);

			const updatedStyles = shouldUseModified
				? modifiedStyles
				: futureStyles;

			const selectors = Object.keys( modifiedStyles );

			futureStyles = mergeStyles(
				futureStyles,
				updatedStyles,
				selectors
			);
		}

		mergeFutureStyles( activeStyles, [ isActive ] );
		mergeFutureStyles( darkStyles, [ isDark ] );
		mergeFutureStyles( activeDarkStyles, [ isActive, isDark ], true );

		setCurrentStyles( futureStyles );
	}, [ isActive, isDark ] );

	const {
		'inserter-search-form__container': containerStyle,
		'inserter-search-form__input-container': inputContainerStyle,
		'inserter-search-form__form-input': formInputStyle,
		'inserter-search-form__form-input-placeholder': placeholderStyle,
		'inserter-search-form__input-button': inputButtonStyle,
		'inserter-search-form__input-button-left': inputButtonLeftStyle,
		'inserter-search-form__input-button-right': inputButtonRightStyle,
		'inserter-search-form__cancel-button': cancelButtonStyle,
		'inserter-search-form__cancel-button-text': cancelButtonTextStyle,
		'inserter-search-form__icon': iconStyle,
		'inserter-search-form__right-icon': rightIconStyle,
	} = currentStyles;

	function clearInput() {
		onChange( '' );
	}

	function onCancel() {
		inputRef.current.blur();
		clearInput();
		setIsActive( false );
	}

	function renderLeftButton() {
		const button =
			! isIOS && isActive ? (
				<Button
					label={ __( 'Cancel Search' ) }
					icon={ arrowLeftIcon }
					onClick={ onCancel }
					style={ iconStyle }
				/>
			) : (
				<Icon icon={ Gridicons.search } fill={ iconStyle?.color } />
			);

		return (
			<View style={ [ inputButtonStyle, inputButtonLeftStyle ] }>
				{ button }
			</View>
		);
	}

	function renderRightButton() {
		let button;

		// Add a View element to properly center the input placeholder via flexbox.
		if ( isIOS && ! isActive ) {
			button = <View />;
		}

		if ( !! value ) {
			button = (
				<Button
					label={ __( 'Clear Search' ) }
					icon={ isIOS ? cancelCircleFilledIcon : closeIcon }
					onClick={ clearInput }
					style={ [ iconStyle, rightIconStyle ] }
				/>
			);
		}

		return (
			<View style={ [ inputButtonStyle, inputButtonRightStyle ] }>
				{ button }
			</View>
		);
	}

	function renderCancel() {
		if ( ! isIOS ) {
			return null;
		}
		return (
			<View style={ [ cancelButtonStyle, { alignSelf: 'flex-start' } ] }>
				<Text
					onPress={ onCancel }
					style={ cancelButtonTextStyle }
					accessible={ true }
					accessibilityRole={ 'button' }
					accessibilityLabel={ __( 'Cancel Search' ) }
					accessibilityHint={ __( 'Cancel Search' ) }
				>
					{ __( 'Cancel' ) }
				</Text>
			</View>
		);
	}

	return (
		<TouchableOpacity
			style={ containerStyle }
			onPress={ () => {
				setIsActive( true );
				inputRef.current.focus();
			} }
			activeOpacity={ 1 }
		>
			<View style={ { flex: 1, flexDirection: 'row' } }>
				<View style={ inputContainerStyle }>
					{ renderLeftButton() }
					<TextInput
						ref={ inputRef }
						style={ formInputStyle }
						placeholderTextColor={ placeholderStyle?.color }
						onChangeText={ onChange }
						onFocus={ () => setIsActive( true ) }
						value={ value }
						placeholder={ __( 'Search blocks' ) }
					/>
					{ renderRightButton() }
				</View>
				{ isActive && renderCancel() }
			</View>
		</TouchableOpacity>
	);
}

export default InserterSearchForm;
